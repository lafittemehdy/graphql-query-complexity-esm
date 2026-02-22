/**
 * Default maximum number of AST nodes to visit during complexity calculation.
 * Acts as a safeguard against queries with an extreme number of selections.
 */
export const DEFAULT_MAX_NODES = 10_000;

/**
 * GraphQL error extension codes used by the complexity validator.
 *
 * @example
 * ```typescript
 * if (error.extensions?.code === ERROR_CODES.QUERY_TOO_COMPLEX) {
 *   // handle complexity violation
 * }
 * ```
 */
export const ERROR_CODES = Object.freeze({
	ESTIMATOR_ERROR: "ESTIMATOR_ERROR",
	NODE_LIMIT_EXCEEDED: "NODE_LIMIT_EXCEEDED",
	QUERY_TOO_COMPLEX: "QUERY_TOO_COMPLEX",
} as const);
