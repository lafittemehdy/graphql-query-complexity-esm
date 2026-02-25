import type {
	DocumentNode,
	FieldNode,
	GraphQLCompositeType,
	GraphQLField,
	GraphQLSchema,
	ValidationRule,
} from "graphql";

// ---------------------------------------------------------------------------
// Estimator types
// ---------------------------------------------------------------------------

/**
 * Arguments passed to a {@link ComplexityEstimator} function.
 *
 * The estimator receives the fully-resolved field context so it can make
 * cost decisions based on arguments, child complexity, parent type, etc.
 */
export interface ComplexityEstimatorArgs {
	/**
	 * Field arguments with variables already coerced.
	 *
	 * Uses `graphql`'s `getArgumentValues` for proper coercion of enums,
	 * lists, input objects, and variable references.
	 */
	args: Record<string, unknown>;

	/**
	 * Sum of the complexity scores computed for every child field inside this
	 * field's selection set.  Zero for scalar / leaf fields.
	 */
	childComplexity: number;

	/** The resolved field definition from the parent type. */
	field: GraphQLField<unknown, unknown>;

	/** The raw AST node for this field selection. */
	node: FieldNode;

	/** The parent composite type that owns this field. */
	type: GraphQLCompositeType;
}

/**
 * Configuration object for programmatic complexity extensions with multipliers.
 *
 * Assign to `field.extensions.complexity` for directive-like behavior
 * without SDL annotations.
 *
 * @example
 * ```typescript
 * // Object form with multipliers
 * field.extensions = {
 *   complexity: { value: 2, multipliers: ["limit"] },
 * };
 *
 * // Simple form (flat number) is also supported
 * field.extensions = { complexity: 10 };
 * ```
 */
export interface ComplexityExtensionConfig {
	/** Optional list of argument names whose runtime values are multiplied together. */
	multipliers?: string[];
	/** Base complexity cost for the field. */
	value: number;
}

/**
 * A function that estimates the cost of a single field.
 *
 * Estimators are tried **in order**.  The first one that returns a finite
 * `number` wins; returning `undefined` defers to the next estimator.
 *
 * @example
 * ```typescript
 * // Fixed cost per field
 * const fixed: ComplexityEstimator = () => 1;
 *
 * // Multiply by a pagination argument
 * const paginated: ComplexityEstimator = ({ args, childComplexity }) => {
 *   if (typeof args.limit === "number") {
 *     return args.limit * (1 + childComplexity);
 *   }
 *   return undefined; // defer to next estimator
 * };
 * ```
 */
export type ComplexityEstimator = (options: ComplexityEstimatorArgs) => number | undefined;

// ---------------------------------------------------------------------------
// Options / callback
// ---------------------------------------------------------------------------

/**
 * Per-operation complexity scores keyed by operation name.
 *
 * Anonymous operations receive deterministic keys like `"[anonymous]"`,
 * `"[anonymous:2]"`, etc.
 */
export type ComplexityByOperation = Record<string, number>;

/**
 * Callback invoked after all operations in the document have been analyzed.
 *
 * Receives a map of operation-name to complexity score.
 *
 * @example
 * ```typescript
 * const callback: ComplexityCallback = (complexities) => {
 *   for (const [name, cost] of Object.entries(complexities)) {
 *     console.log(`${name}: ${cost}`);
 *   }
 * };
 * ```
 */
export type ComplexityCallback = (queryComplexities: ComplexityByOperation) => void;

/**
 * Details about a field argument coercion failure.
 */
export interface CoercionErrorInfo {
	/** The underlying error thrown by `getArgumentValues`. */
	error: unknown;
	/** Name of the field whose arguments failed to coerce. */
	fieldName: string;
	/** Name of the parent type that owns the field. */
	parentType: string;
}

/**
 * Configuration object accepted by {@link ComplexityLimitFunction}.
 */
export interface ComplexityLimitOptions {
	/**
	 * Default complexity cost assigned when **no estimator** returns a value.
	 *
	 * A value of `0` makes unmatched fields effectively free (only child
	 * complexity propagates).  Use with caution — it may hide fields from
	 * the complexity budget.
	 *
	 * @default 1
	 */
	defaultComplexity?: number;

	/**
	 * Ordered list of estimator functions.  The first estimator that returns a
	 * finite number is used as the field's cost.
	 *
	 * When omitted a built-in {@link simpleEstimator} with
	 * `defaultComplexity` is used.
	 */
	estimators?: ComplexityEstimator[];

	/**
	 * Maximum number of AST selection nodes to visit.
	 * Acts as a safeguard against extremely wide queries.
	 *
	 * @default 10_000
	 */
	maxNodes?: number;

	/**
	 * Called when field argument coercion fails (e.g. invalid variable types).
	 *
	 * When coercion fails, multiplier-based cost calculation falls back to a
	 * multiplier of `1`, which may **underestimate** query complexity. Use
	 * this callback to log warnings or take corrective action.
	 *
	 * @param info - Details about the coercion failure.
	 *
	 * @example
	 * ```typescript
	 * complexityLimit(1000, {
	 *   onCoercionError: ({ error, fieldName, parentType }) => {
	 *     console.warn(`Coercion failed for ${parentType}.${fieldName}:`, error);
	 *   },
	 * });
	 * ```
	 */
	onCoercionError?: (info: CoercionErrorInfo) => void;

	/**
	 * Query variables for proper argument coercion and `@skip` / `@include`
	 * evaluation.
	 *
	 * @default \{\}
	 */
	variables?: Record<string, unknown>;
}

/**
 * Overloaded signatures for the `complexityLimit` factory.
 */
export interface ComplexityLimitFunction {
	/**
	 * Create a validation rule with default options.
	 *
	 * @param maxComplexity - Maximum allowed complexity score.
	 */
	(maxComplexity: number): ValidationRule;

	/**
	 * Create a validation rule with custom options.
	 *
	 * @param maxComplexity - Maximum allowed complexity score.
	 * @param options       - Configuration options.
	 */
	(maxComplexity: number, options: ComplexityLimitOptions): ValidationRule;

	/**
	 * Create a validation rule with a per-operation callback.
	 *
	 * @param maxComplexity - Maximum allowed complexity score.
	 * @param callback      - Invoked with a map of operation-name → complexity.
	 */
	(maxComplexity: number, callback: ComplexityCallback): ValidationRule;

	/**
	 * Create a validation rule with custom options and a callback.
	 *
	 * @param maxComplexity - Maximum allowed complexity score.
	 * @param options       - Configuration options.
	 * @param callback      - Invoked with a map of operation-name → complexity.
	 */
	(
		maxComplexity: number,
		options: ComplexityLimitOptions,
		callback: ComplexityCallback,
	): ValidationRule;
}

// ---------------------------------------------------------------------------
// getComplexity
// ---------------------------------------------------------------------------

/**
 * Options for programmatic complexity calculation via {@link getComplexity}.
 */
export interface GetComplexityOptions {
	/**
	 * Ordered list of estimator functions.
	 */
	estimators: ComplexityEstimator[];

	/**
	 * Maximum number of AST selection nodes to visit.
	 *
	 * @default 10_000
	 */
	maxNodes?: number;

	/**
	 * The GraphQL query — either a raw string or a pre-parsed `DocumentNode`.
	 */
	query: string | DocumentNode;

	/**
	 * The GraphQL schema to validate and resolve types against.
	 */
	schema: GraphQLSchema;

	/**
	 * Query variables for argument coercion and directive evaluation.
	 *
	 * @default \{\}
	 */
	variables?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

/**
 * Thrown by {@link getComplexity} when the query fails standard GraphQL
 * validation (syntax errors, unknown fields, etc.).
 *
 * Provides access to the underlying `GraphQLError` instances.
 *
 * @example
 * ```typescript
 * try {
 *   getComplexity({ query: "{ bad }", schema, estimators });
 * } catch (error) {
 *   if (error instanceof QueryComplexityValidationError) {
 *     console.log(error.errors); // GraphQLError[]
 *   }
 * }
 * ```
 */
export class QueryComplexityValidationError extends Error {
	constructor(public readonly errors: readonly import("graphql").GraphQLError[]) {
		super(errors.map((e) => e.message).join("\n"));
		this.name = "QueryComplexityValidationError";
	}
}
