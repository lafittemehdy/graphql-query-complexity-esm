import {
  type DocumentNode,
  type GraphQLSchema,
  parse,
  specifiedRules,
  validate,
} from "graphql";
import { createQueryComplexityValidator } from "./QueryComplexity.js";
import type { ComplexityEstimator } from "./types.js";

/**
 * Options for programmatic complexity calculation
 */
export interface GetComplexityOptions {
  /**
   * Array of complexity estimator functions
   */
  estimators: ComplexityEstimator[];

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
  variables?: Record<string, any>;
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
 * @throws {Error} If the query has validation errors
 *
 * @example
 * ```typescript
 * import { getComplexity, simpleEstimator } from 'graphql-query-complexity-esm';
 *
 * const complexity = getComplexity({
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
 *   estimators: [
 *     ({ args, childComplexity }) => {
 *       const limit = args.limit ?? 10;
 *       return limit * (1 + childComplexity);
 *     },
 *     simpleEstimator({ defaultComplexity: 1 }),
 *   ],
 * });
 *
 * console.log('Query complexity:', complexity);
 * ```
 */
export function getComplexity(options: GetComplexityOptions): number {
  const { estimators, query, schema, variables = {} } = options;

  // Parse query if it's a string
  const document: DocumentNode =
    typeof query === "string" ? parse(query) : query;

  // Create a complexity tracker
  let calculatedComplexity = 0;

  // Create validation rule with a high maximum (we just want to calculate, not validate)
  const complexityRule = createQueryComplexityValidator({
    estimators,
    maximumComplexity: Number.MAX_SAFE_INTEGER,
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

  // If there are validation errors, throw
  if (errors.length > 0) {
    throw new Error(
      `Query validation failed: ${errors.map((e) => e.message).join(", ")}`,
    );
  }

  return calculatedComplexity;
}
