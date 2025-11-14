/**
 * GraphQL Query Complexity Analysis - ESM Compatible
 *
 * A GraphQL validation rule that analyzes and limits query complexity.
 * Prevents resource-intensive queries from overloading your server.
 *
 * @packageDocumentation
 */

export { type GetComplexityOptions, getComplexity } from "./getComplexity.js";
// Main exports
export { createQueryComplexityValidator } from "./QueryComplexity.js";
export {
  type ComplexityEstimator,
  type ComplexityEstimatorArgs,
  fieldExtensionsEstimator,
  type QueryComplexityOptions,
  QueryComplexityValidationError,
  simpleEstimator,
} from "./types.js";
