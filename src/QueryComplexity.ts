import {
  type ASTVisitor,
  type FieldNode,
  GraphQLError,
  GraphQLIncludeDirective,
  GraphQLSkipDirective,
  getArgumentValues,
  getDirectiveValues,
  getNamedType,
  isCompositeType,
  Kind,
  type OperationDefinitionNode,
  type SelectionSetNode,
  type ValidationContext,
} from "graphql";
import type { ComplexityEstimator, QueryComplexityOptions } from "./types.js";

const DEFAULT_MAX_NODES = 10000;

/**
 * Creates a validation rule for GraphQL query complexity
 *
 * This validator calculates the complexity of a GraphQL query and rejects it
 * if it exceeds the maximum allowed complexity. It properly handles:
 * - Variables and argument coercion
 * - @include and @skip directives
 * - Fragments (named and inline)
 * - Abstract types (interfaces and unions)
 * - Custom complexity estimators
 *
 * @param options - Configuration options
 * @returns A validation rule function
 *
 * @example
 * ```typescript
 * import { validate, specifiedRules } from 'graphql';
 * import { createQueryComplexityValidator, simpleEstimator } from 'graphql-query-complexity-esm';
 *
 * const complexityRule = createQueryComplexityValidator({
 *   maximumComplexity: 1000,
 *   estimators: [simpleEstimator({ defaultComplexity: 1 })],
 *   schema,
 *   variables,
 *   onComplete: (complexity) => console.log('Query complexity:', complexity),
 * });
 *
 * const errors = validate(schema, documentAST, [...specifiedRules, complexityRule]);
 * ```
 */
export function createQueryComplexityValidator(
  options: QueryComplexityOptions,
): (context: ValidationContext) => ASTVisitor {
  const {
    estimators,
    maximumComplexity,
    onComplete,
    schema,
    variables = {},
  } = options;

  // Validate options
  if (!Number.isFinite(maximumComplexity) || maximumComplexity <= 0) {
    throw new Error(
      `Invalid maximumComplexity: ${maximumComplexity}. Must be a positive finite number.`,
    );
  }

  if (!Array.isArray(estimators) || estimators.length === 0) {
    throw new Error("At least one complexity estimator is required.");
  }

  return (context: ValidationContext): ASTVisitor => {
    let totalComplexity = 0;
    let hasReportedError = false;

    return {
      // Calculate complexity once per operation definition
      OperationDefinition(operation: OperationDefinitionNode) {
        if (!operation.selectionSet) {
          return false; // Don't visit children
        }

        // Get schema from ValidationContext if not provided in options
        const actualSchema = schema || context.getSchema();

        // Get the root type for this operation
        const operationType = operation.operation;
        const rootType =
          operationType === "query"
            ? actualSchema.getQueryType()
            : operationType === "mutation"
              ? actualSchema.getMutationType()
              : actualSchema.getSubscriptionType();

        if (!rootType) {
          return false;
        }

        // Track visited fragments to detect cycles
        const visitedFragments = new Set<string>();

        // Calculate complexity for this operation
        const result = calculateComplexity(
          operation.selectionSet,
          context,
          estimators,
          variables,
          0,
          rootType,
          actualSchema,
          visitedFragments,
        );
        totalComplexity = result.complexity;

        // Check node limit (DoS protection)
        if (result.nodeCount > DEFAULT_MAX_NODES && !hasReportedError) {
          hasReportedError = true;
          context.reportError(
            new GraphQLError(
              `Query exceeds maximum node limit of ${DEFAULT_MAX_NODES}. This query has ${result.nodeCount} nodes.`,
              {
                extensions: {
                  code: "QUERY_TOO_COMPLEX",
                },
                nodes: [operation],
              },
            ),
          );
        }

        // Check complexity limit
        if (totalComplexity > maximumComplexity && !hasReportedError) {
          hasReportedError = true;
          context.reportError(
            new GraphQLError(
              `Query exceeds maximum complexity of ${maximumComplexity}. Actual complexity is ${totalComplexity}.`,
              {
                extensions: {
                  code: "QUERY_TOO_COMPLEX",
                  complexity: totalComplexity,
                  maximumComplexity,
                },
                nodes: [operation],
              },
            ),
          );
        }

        // Return false to prevent the visitor from traversing child nodes again
        return false;
      },

      // Invoke onComplete callback when document visiting is complete
      Document: {
        leave() {
          if (onComplete && !hasReportedError) {
            onComplete(totalComplexity);
          }
        },
      },
    };
  };
}

interface ComplexityResult {
  complexity: number;
  nodeCount: number;
}

/**
 * Calculate the complexity of a selection set
 */
function calculateComplexity(
  node: SelectionSetNode,
  context: ValidationContext,
  estimators: ComplexityEstimator[],
  variables: Record<string, any>,
  currentNodeCount: number,
  parentType?: any,
  schema?: any,
  visitedFragments?: Set<string>,
): ComplexityResult {
  let complexity = 0;
  let nodeCount = currentNodeCount;

  for (const selection of node.selections) {
    nodeCount++;

    if (selection.kind === Kind.FIELD) {
      // Handle @skip and @include directives
      if (shouldSkipNode(selection, variables)) {
        continue;
      }

      const fieldComplexity = calculateFieldComplexity(
        selection,
        context,
        estimators,
        variables,
        nodeCount,
        parentType,
        schema,
        visitedFragments,
      );
      complexity += fieldComplexity.complexity;
      nodeCount = fieldComplexity.nodeCount;
    } else if (selection.kind === Kind.INLINE_FRAGMENT) {
      // Handle @skip and @include on inline fragments
      if (shouldSkipNode(selection, variables)) {
        continue;
      }

      if (selection.selectionSet) {
        // Determine the type for the inline fragment
        const fragmentType = selection.typeCondition
          ? context.getSchema().getType(selection.typeCondition.name.value)
          : parentType;

        const fragmentComplexity = calculateComplexity(
          selection.selectionSet,
          context,
          estimators,
          variables,
          nodeCount,
          fragmentType,
          schema,
          visitedFragments,
        );
        complexity += fragmentComplexity.complexity;
        nodeCount = fragmentComplexity.nodeCount;
      }
    } else if (selection.kind === Kind.FRAGMENT_SPREAD) {
      // Handle @skip and @include on fragment spreads
      if (shouldSkipNode(selection, variables)) {
        continue;
      }

      const fragmentName = selection.name.value;

      // Detect circular fragment references
      if (visitedFragments?.has(fragmentName)) {
        // Skip this fragment to prevent infinite recursion
        // GraphQL validation should have caught this, but we protect against it anyway
        continue;
      }

      const fragment = context.getFragment(fragmentName);
      if (fragment?.selectionSet) {
        // Mark fragment as visited
        visitedFragments?.add(fragmentName);

        // Get the fragment's type
        const fragmentType = context
          .getSchema()
          .getType(fragment.typeCondition.name.value);

        const fragmentComplexity = calculateComplexity(
          fragment.selectionSet,
          context,
          estimators,
          variables,
          nodeCount,
          fragmentType,
          schema,
          visitedFragments,
        );
        complexity += fragmentComplexity.complexity;
        nodeCount = fragmentComplexity.nodeCount;

        // Remove fragment from visited set to allow it to be used in parallel branches
        visitedFragments?.delete(fragmentName);
      }
    }
  }

  return { complexity, nodeCount };
}

/**
 * Calculate complexity for a single field
 */
function calculateFieldComplexity(
  field: FieldNode,
  context: ValidationContext,
  estimators: ComplexityEstimator[],
  variables: Record<string, any>,
  currentNodeCount: number,
  parentType?: any,
  schema?: any,
  visitedFragments?: Set<string>,
): ComplexityResult {
  let nodeCount = currentNodeCount;

  // If no parent type provided or not a composite type, use default
  if (!parentType || !isCompositeType(parentType)) {
    return { complexity: 1, nodeCount };
  }

  // Get field definition from parent type
  const fieldName = field.name.value;
  const fields = (parentType as any).getFields?.();
  const fieldDef = fields?.[fieldName];

  if (!fieldDef) {
    return { complexity: 1, nodeCount };
  }

  // Use getArgumentValues from graphql/execution/values for proper coercion
  // This handles variables, enums, lists, objects, etc.
  let args: Record<string, any>;
  try {
    args = getArgumentValues(fieldDef, field, variables);
  } catch (_error) {
    // If argument validation fails (e.g., missing required args),
    // use empty args object. The actual GraphQL validation will catch this.
    args = {};
  }

  // Get the field's return type (unwrap non-null and list wrappers)
  const fieldType = getNamedType(fieldDef.type);

  // Calculate child complexity
  let childComplexity = 0;
  if (field.selectionSet) {
    const childResult = calculateComplexity(
      field.selectionSet,
      context,
      estimators,
      variables,
      nodeCount,
      fieldType,
      schema,
      visitedFragments,
    );
    childComplexity = childResult.complexity;
    nodeCount = childResult.nodeCount;
  }

  // Try each estimator
  for (const estimator of estimators) {
    const estimate = estimator({
      args,
      childComplexity,
      field: fieldDef,
      node: field,
      type: parentType,
    });

    if (typeof estimate === "number" && Number.isFinite(estimate)) {
      return { complexity: estimate, nodeCount };
    }
  }

  // No estimator returned a value - this should not happen if estimators are properly configured
  // Default: 1 + child complexity
  return { complexity: 1 + childComplexity, nodeCount };
}

/**
 * Determine if a node should be skipped based on @skip and @include directives
 */
function shouldSkipNode(
  node: { readonly directives?: ReadonlyArray<any> },
  variables: Record<string, any>,
): boolean {
  // Check @skip directive
  const skipDirective = getDirectiveValues(
    GraphQLSkipDirective,
    node,
    variables,
  );
  if (skipDirective?.if === true) {
    return true;
  }

  // Check @include directive
  const includeDirective = getDirectiveValues(
    GraphQLIncludeDirective,
    node,
    variables,
  );
  if (includeDirective?.if === false) {
    return true;
  }

  return false;
}
