import {
  type DocumentNode,
  type GraphQLSchema,
  parse,
  specifiedRules,
  validate,
} from "graphql";
import { createQueryComplexityValidator } from "./QueryComplexity.js";
import {
  type ComplexityEstimator,
  QueryComplexityValidationError,
} from "./types.js";

/**
 * Options for programmatic complexity calculation
 */
export interface GetComplexityOptions {
  /**
   * Array of complexity estimator functions
   */
  estimators: ComplexityEstimator[];

  /**
   * Maximum number of nodes to visit.
   * This is a safeguard against malicious queries that could cause performance issues.
   *
   * @default 10000
   */
  maximumNodeCount?: number;

  /**
   * The GraphQL query (as string or DocumentNode)
   */
  query: string | DocumentNode;

  /**
   * GraphQL schema
   */
  schema: GraphQLSchema;

  /**
   * Query variables (optional)
   */
  variables?: Record<string, unknown>;
}

/**
 * Calculate the complexity of a GraphQL query programmatically
 *
 * This function calculates query complexity outside of the normal validation flow.
 * Useful for:
 * - Logging query complexity
 * - Pre-execution analysis
 * - Rate limiting based on complexity
 * - Analytics and monitoring
 *
 * @param options - Configuration options
 * @returns The calculated complexity as a number
 * @throws {QueryComplexityValidationError} If the query has validation errors
 *
 * @example
 * ```typescript
 * import { getComplexity, simpleEstimator } from 'graphql-query-complexity-esm';
 *
 * const complexity = getComplexity({
 *   estimators: [
 *     ({ args, childComplexity }) => {
 *       const limit = args.limit ?? 10;
 *       return limit * (1 + childComplexity);
 *     },
 *     simpleEstimator({ defaultComplexity: 1 }),
 *   ],
 *   query: `
 *     query GetUsers($limit: Int!) {
 *       users(limit: $limit) {
 *         id
 *         posts {
 *           title
 *         }
 *       }
 *     }
 *   `,
 *   schema,
 *   variables: { limit: 10 },
 * });
 *
 * console.log('Query complexity:', complexity);
 * ```
 */
export function getComplexity(options: GetComplexityOptions): number {
  const {
    estimators,
    maximumNodeCount,
    query,
    schema,
    variables = {},
  } = options;

  // Parse query if it's a string
  const document: DocumentNode =
    typeof query === "string" ? parse(query) : query;

  // Create a complexity tracker
  let calculatedComplexity = 0;

  // Create validation rule with a high maximum (we just want to calculate, not validate)
  const complexityRule = createQueryComplexityValidator({
    estimators,
    maximumComplexity: Number.MAX_SAFE_INTEGER,
    maximumNodeCount,
    onComplete: (complexity) => {
      calculatedComplexity = complexity;
    },
    schema,
    variables,
  });

  // Validate the document with both standard rules and complexity rule
  const errors = validate(schema, document, [
    ...specifiedRules,
    complexityRule,
  ]);

  // If there are validation errors, throw a custom error
  if (errors.length > 0) {
    throw new QueryComplexityValidationError(errors);
  }

  return calculatedComplexity;
}
