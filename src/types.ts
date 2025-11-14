import type {
  FieldNode,
  GraphQLCompositeType,
  GraphQLError,
  GraphQLField,
  GraphQLSchema,
} from "graphql";

/**
 * Arguments passed to complexity estimators
 */
export interface ComplexityEstimatorArgs {
  /**
   * Field arguments (properly coerced and including variables)
   */
  args: Record<string, unknown>;

  /**
   * The estimated complexity of child selections
   */
  childComplexity: number;

  /**
   * The GraphQL field definition
   */
  field: GraphQLField<unknown, unknown>;

  /**
   * The AST field node
   */
  node: FieldNode;

  /**
   * Parent composite type (Object, Interface, or Union)
   */
  type: GraphQLCompositeType;
}

/**
 * Estimator function to calculate complexity for a field
 *
 * @param options - Arguments passed to the estimator
 * @returns The estimated complexity as a number, or void/undefined to defer to next estimator
 *
 * @example
 * // Simple fixed complexity
 * const estimator: ComplexityEstimator = () => 1;
 *
 * @example
 * // Complexity based on arguments
 * const estimator: ComplexityEstimator = ({ args, childComplexity }) => {
 *   const limit = args.limit ?? 10;
 *   return limit * (1 + childComplexity);
 * };
 */
export type ComplexityEstimator = (
  options: ComplexityEstimatorArgs,
) => number | undefined;

/**
 * Options for query complexity validation
 */
export interface QueryComplexityOptions {
  /**
   * Array of complexity estimator functions
   * Estimators are tried in order until one returns a number
   */
  estimators: ComplexityEstimator[];

  /**
   * Maximum allowed query complexity
   */
  maximumComplexity: number;

  /**
   * Maximum number of nodes to visit.
   * This is a safeguard against malicious queries that could cause performance issues.
   *
   * @default 10000
   */
  maximumNodeCount?: number;

  /**
   * Optional callback invoked when complexity calculation completes
   * Useful for logging and monitoring
   *
   * @param complexity - The final calculated complexity
   */
  onComplete?: (complexity: number) => void;

  /**
   * GraphQL schema (optional - will use schema from ValidationContext if not provided)
   */
  schema?: GraphQLSchema;

  /**
   * Query variables (optional)
   * Used to properly coerce argument values that reference variables
   */
  variables?: Record<string, unknown>;
}

/**
 * Custom error class for query complexity validation failures.
 * This error is thrown by `getComplexity` when validation fails,
 * providing access to the underlying GraphQL errors.
 */
export class QueryComplexityValidationError extends Error {
  constructor(public readonly errors: readonly GraphQLError[]) {
    const message = errors.map((error) => error.message).join("\n");
    super(message);
    this.name = "QueryComplexityValidationError";
  }
}

/**
 * Field-specific complexity estimator that uses the `@complexity` directive
 * on a field definition.
 *
 * @returns A complexity estimator function
 *
 * @example
 * // 1. Define the directive in your schema
 * const typeDefs = `
 *   directive @complexity(
 *     value: Int!,
 *     multipliers: [String!]
 *   ) on FIELD_DEFINITION
 *
 *   type Query {
 *     posts(limit: Int): [Post!]! @complexity(value: 1, multipliers: ["limit"])
 *   }
 * `;
 *
 * // 2. Use the estimator
 * const estimators = [
 *   fieldExtensionsEstimator(),
 *   simpleEstimator({ defaultComplexity: 1 })
 * ];
 */
export function fieldExtensionsEstimator(): ComplexityEstimator {
  return ({ args, childComplexity, field }) => {
    const complexity = field.extensions?.complexity;

    // Read complexity from directive if not found in extensions
    if (complexity === undefined && field.astNode?.directives) {
      const complexityDirective = field.astNode.directives.find(
        (d) => d.name.value === "complexity",
      );

      if (complexityDirective?.arguments) {
        const valueArg = complexityDirective.arguments.find(
          (arg) => arg.name.value === "value",
        );
        const multipliersArg = complexityDirective.arguments.find(
          (arg) => arg.name.value === "multipliers",
        );

        if (valueArg?.value.kind === "IntValue") {
          const baseComplexity = Number.parseInt(valueArg.value.value, 10);
          if (!Number.isFinite(baseComplexity)) {
            return undefined;
          }

          let totalMultiplier = 1;
          if (multipliersArg?.value.kind === "ListValue") {
            for (const multiplier of multipliersArg.value.values) {
              if (
                multiplier.kind === "StringValue" &&
                typeof args[multiplier.value] === "number" &&
                Number.isFinite(args[multiplier.value])
              ) {
                totalMultiplier *= args[multiplier.value] as number;
              }
            }
          }

          return baseComplexity + totalMultiplier * childComplexity;
        }
      }
    }

    // Handle complexity defined as a number in extensions
    if (typeof complexity === "number" && Number.isFinite(complexity)) {
      return complexity + childComplexity;
    }

    // Defer to the next estimator
    return undefined;
  };
}

/**
 * Simple estimator that returns a fixed complexity per field plus child complexity
 *
 * IMPORTANT: This estimator does NOT account for list multipliers based on arguments
 * like `limit`, `first`, or similar pagination parameters. For queries with lists,
 * you should provide a custom estimator that multiplies by the list size.
 *
 * @param options - Configuration options
 * @param options.defaultComplexity - The complexity value for each field (default: 1)
 * @returns A complexity estimator function
 *
 * @example
 * // Basic usage
 * const estimator = simpleEstimator({ defaultComplexity: 2 });
 *
 * @example
 * // For production use with lists, combine with a custom estimator:
 * const estimators = [
 *   // Custom estimator for fields with pagination
 *   ({ args, childComplexity }) => {
 *     if (args.limit !== undefined) {
 *       return args.limit * (1 + childComplexity);
 *     }
 *     return undefined; // Fall through to next estimator
 *   },
 *   // Fallback for other fields
 *   simpleEstimator({ defaultComplexity: 1 })
 * ];
 */
export function simpleEstimator(
  options: { defaultComplexity?: number } = {},
): ComplexityEstimator {
  const defaultComplexity = options.defaultComplexity ?? 1;

  return ({ childComplexity }) => defaultComplexity + childComplexity;
}
