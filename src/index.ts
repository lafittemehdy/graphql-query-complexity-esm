/**
 * GraphQL Query Complexity Analysis — ESM Compatible
 *
 * A validation rule that calculates query complexity scores and rejects
 * expensive queries before execution.  Works with any GraphQL server.
 *
 * @packageDocumentation
 */

// Exports are sorted by module path (biome's organizeImports rule), not by
// export name. This is enforced by the linter and is intentional.
export { complexityLimit } from "./complexity-rule.js";
export { ERROR_CODES } from "./constants.js";
export { complexityDirectiveTypeDefs } from "./directives.js";
export { fieldExtensionsEstimator, simpleEstimator } from "./estimators.js";
export { getComplexity, getComplexityBreakdown } from "./get-complexity.js";
export type {
	ComplexityByOperation,
	ComplexityCallback,
	ComplexityEstimator,
	ComplexityEstimatorArgs,
	ComplexityExtensionConfig,
	ComplexityLimitFunction,
	ComplexityLimitOptions,
	GetComplexityOptions,
} from "./types.js";
export { QueryComplexityValidationError } from "./types.js";
