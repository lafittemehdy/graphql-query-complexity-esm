import type {
  FieldNode,
  GraphQLCompositeType,
  GraphQLField,
  GraphQLSchema,
} from "graphql";

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
 * Arguments passed to complexity estimators
 */
export interface ComplexityEstimatorArgs {
  /**
   * Field arguments (properly coerced and including variables)
   */
  args: Record<string, any>;

  /**
   * The estimated complexity of child selections
   */
  childComplexity: number;

  /**
   * The GraphQL field definition
   */
  field: GraphQLField<any, any>;

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
  variables?: Record<string, any>;
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

/**
 * Field-specific complexity estimator that uses field extensions
 * Falls back to 1 + child complexity
 *
 * @returns A complexity estimator function
 *
 * @example
 * const estimator = fieldExtensionsEstimator();
 */
export function fieldExtensionsEstimator(): ComplexityEstimator {
  return ({ field, childComplexity }) => {
    // Check if field has complexity defined in extensions
    const extensionComplexity = field.extensions?.complexity;

    if (
      typeof extensionComplexity === "number" &&
      Number.isFinite(extensionComplexity)
    ) {
      return extensionComplexity;
    }

    // Check AST node directives for complexity
    if (field.astNode?.directives) {
      const complexityDirective = field.astNode.directives.find(
        (d) => d.name.value === "complexity",
      );

      if (complexityDirective?.arguments?.[0]) {
        const arg = complexityDirective.arguments[0];
        if (arg.value.kind === "IntValue") {
          const value = Number.parseInt(arg.value.value, 10);
          if (Number.isFinite(value)) {
            return value;
          }
        }
      }
    }

    // Default complexity calculation: 1 + child complexity
    return 1 + childComplexity;
  };
}
