import {
	type DocumentNode,
	GraphQLError,
	isSchema,
	parse,
	specifiedRules,
	validate,
} from "graphql";
import { complexityLimit } from "./complexity-rule.js";
import {
	type ComplexityByOperation,
	type GetComplexityOptions,
	QueryComplexityValidationError,
} from "./types.js";
import { createNullPrototypeRecord, describeValueType } from "./utils.js";
import { assertEstimatorArray, assertOptionsObject, assertPlainObjectValue } from "./validation.js";

interface NormalizedGetComplexityInput {
	document: DocumentNode;
	estimators: GetComplexityOptions["estimators"];
	maxNodes: GetComplexityOptions["maxNodes"];
	schema: GetComplexityOptions["schema"];
	variables: Record<string, unknown>;
}

function isDocumentNode(value: unknown): value is DocumentNode {
	if (typeof value !== "object" || value === null) return false;
	return (
		"kind" in value &&
		value.kind === "Document" &&
		"definitions" in value &&
		Array.isArray(value.definitions)
	);
}

function normalizeGetComplexityInput(options: GetComplexityOptions): NormalizedGetComplexityInput {
	assertOptionsObject(options);

	const { estimators, maxNodes, query, schema, variables = {} } = options;

	if (typeof query !== "string" && !isDocumentNode(query)) {
		throw new TypeError(`query must be a string or DocumentNode, got ${describeValueType(query)}.`);
	}

	if (!isSchema(schema)) {
		throw new TypeError("schema must be a GraphQLSchema instance.");
	}

	assertEstimatorArray(estimators);

	if (
		maxNodes !== undefined &&
		(!Number.isFinite(maxNodes) || !Number.isInteger(maxNodes) || maxNodes <= 0)
	) {
		throw new RangeError(`maxNodes must be a positive integer, got ${maxNodes}.`);
	}

	assertPlainObjectValue(variables, "variables");

	let document: DocumentNode;
	if (typeof query === "string") {
		try {
			document = parse(query);
		} catch (error: unknown) {
			if (error instanceof GraphQLError) {
				throw new QueryComplexityValidationError([error]);
			}
			throw error;
		}
	} else {
		document = query;
	}

	return { document, estimators, maxNodes, schema, variables };
}

function runComplexityValidation(
	input: NormalizedGetComplexityInput,
): Readonly<ComplexityByOperation> {
	let complexityByOperation: ComplexityByOperation | undefined;

	const rule = complexityLimit(
		Number.MAX_SAFE_INTEGER,
		{
			estimators: input.estimators,
			maxNodes: input.maxNodes,
			variables: input.variables,
		},
		(complexities) => {
			complexityByOperation = complexities;
		},
	);

	const errors = validate(input.schema, input.document, [...specifiedRules, rule]);

	if (errors.length > 0) {
		throw new QueryComplexityValidationError(errors);
	}

	// The callback is always invoked on the Document `leave` event when
	// validation succeeds.  The returned object is already null-prototype
	// (built by complexityLimit) and will not be mutated after validate()
	// returns, so freezing it directly is safe.
	return Object.freeze(complexityByOperation ?? createNullPrototypeRecord<number>());
}

/**
 * Calculate complexity for each operation in a GraphQL document.
 *
 * Returns a record keyed by operation name. Anonymous operations use
 * deterministic keys (`"[anonymous]"`, `"[anonymous:2]"`, etc.).
 *
 * @param options - Configuration options.
 * @returns Frozen record of operation-name to complexity score.
 * @throws {QueryComplexityValidationError} When parsing or GraphQL validation fails.
 */
export function getComplexityBreakdown(
	options: GetComplexityOptions,
): Readonly<ComplexityByOperation> {
	const input = normalizeGetComplexityInput(options);
	return runComplexityValidation(input);
}

/**
 * Calculate the complexity of a GraphQL query **programmatically**, outside
 * of the normal server validation flow.
 *
 * Useful for:
 * - Logging / analytics
 * - Pre-execution analysis
 * - Rate-limiting based on query cost
 * - Testing estimator configurations
 *
 * @param options - Configuration options.
 * @returns The highest complexity score among all operations in the document.
 * @throws {QueryComplexityValidationError} When the query fails standard
 *   GraphQL validation (unknown fields, syntax errors, etc.).
 *
 * @example
 * ```typescript
 * import { getComplexity, simpleEstimator } from "graphql-query-complexity-esm";
 *
 * const cost = getComplexity({
 *   query: `{ users(limit: 10) { id name } }`,
 *   schema,
 *   estimators: [simpleEstimator({ defaultComplexity: 1 })],
 * });
 * console.log("Query cost:", cost);
 * ```
 */
export function getComplexity(options: GetComplexityOptions): number {
	const complexityByOperation = getComplexityBreakdown(options);
	return Object.values(complexityByOperation).reduce((max, cost) => Math.max(max, cost), 0);
}
