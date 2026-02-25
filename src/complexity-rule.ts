import {
	type ASTVisitor,
	GraphQLError,
	type OperationDefinitionNode,
	type ValidationContext,
	type ValidationRule,
} from "graphql";
import {
	calculateComplexity,
	EstimatorExecutionError,
	type TraversalConfig,
} from "./complexity-engine.js";
import { DEFAULT_MAX_NODES, ERROR_CODES } from "./constants.js";
import { simpleEstimator } from "./estimators.js";
import type {
	ComplexityCallback,
	ComplexityLimitFunction,
	ComplexityLimitOptions,
} from "./types.js";
import { createNullPrototypeRecord, describeValueType, isRecordObject } from "./utils.js";

// ---------------------------------------------------------------------------
// Argument normalization
// ---------------------------------------------------------------------------

interface NormalizedArgs {
	callback: ComplexityCallback | undefined;
	options: Required<Pick<ComplexityLimitOptions, "defaultComplexity" | "maxNodes" | "variables">> &
		Pick<ComplexityLimitOptions, "estimators" | "onCoercionError">;
}

/**
 * Normalize the flexible `(max, opts?, cb?)` overloads into a single shape.
 */
function normalizeArgs(
	optionsOrCallback?: ComplexityCallback | ComplexityLimitOptions,
	callbackArg?: ComplexityCallback,
): NormalizedArgs {
	let options: ComplexityLimitOptions = {};
	let callback: ComplexityCallback | undefined = callbackArg;

	if (typeof optionsOrCallback === "function") {
		if (callbackArg !== undefined) {
			throw new TypeError("Callback was provided twice. Pass only one callback function.");
		}
		callback = optionsOrCallback;
	} else if (optionsOrCallback !== null && optionsOrCallback !== undefined) {
		if (!isRecordObject(optionsOrCallback)) {
			throw new TypeError(
				`Expected options to be a plain object, got ${describeValueType(optionsOrCallback)}.`,
			);
		}
		options = optionsOrCallback;
	}

	if (callback !== undefined && typeof callback !== "function") {
		throw new TypeError(`Expected callback to be a function, got ${typeof callback}.`);
	}

	const defaultComplexity = options.defaultComplexity ?? 1;
	if (
		!Number.isFinite(defaultComplexity) ||
		defaultComplexity < 0 ||
		!Number.isInteger(defaultComplexity)
	) {
		throw new RangeError(
			`defaultComplexity must be a non-negative integer, got ${defaultComplexity}.`,
		);
	}

	const maxNodes = options.maxNodes ?? DEFAULT_MAX_NODES;
	if (!Number.isFinite(maxNodes) || maxNodes <= 0 || !Number.isInteger(maxNodes)) {
		throw new RangeError(`maxNodes must be a positive integer, got ${maxNodes}.`);
	}

	if (options.estimators !== undefined) {
		if (!Array.isArray(options.estimators) || options.estimators.length === 0) {
			throw new TypeError("estimators must be a non-empty array of functions.");
		}
		for (const est of options.estimators) {
			if (typeof est !== "function") {
				throw new TypeError(`Every estimator must be a function, got ${typeof est}.`);
			}
		}
	}

	if (options.variables !== undefined && !isRecordObject(options.variables)) {
		throw new TypeError(
			`variables must be a plain object, got ${describeValueType(options.variables)}.`,
		);
	}

	if (options.onCoercionError !== undefined && typeof options.onCoercionError !== "function") {
		throw new TypeError(
			`onCoercionError must be a function, got ${typeof options.onCoercionError}.`,
		);
	}

	return {
		callback,
		options: {
			defaultComplexity,
			estimators: options.estimators,
			maxNodes,
			onCoercionError: options.onCoercionError,
			variables: options.variables ?? {},
		},
	};
}

// ---------------------------------------------------------------------------
// Operation-name allocator (deterministic keys for anonymous operations)
// ---------------------------------------------------------------------------

function createOperationNameAllocator(): (op: OperationDefinitionNode) => string {
	let anonymousCount = 0;
	return (op) => {
		if (op.name?.value) return op.name.value;
		anonymousCount++;
		return anonymousCount === 1 ? "[anonymous]" : `[anonymous:${anonymousCount}]`;
	};
}

// ---------------------------------------------------------------------------
// Main factory
// ---------------------------------------------------------------------------

/**
 * Create a GraphQL validation rule that rejects queries exceeding a
 * maximum complexity score.
 *
 * @param maxComplexity - Positive integer ceiling.
 * @param optionsOrCallback - Options object **or** a callback function.
 * @param callbackArg - Callback when the second argument is options.
 * @returns A standard `ValidationRule` compatible with any GraphQL server.
 *
 * @example
 * ```typescript
 * import { complexityLimit, simpleEstimator } from "graphql-query-complexity-esm";
 *
 * // Simplest usage
 * const rule = complexityLimit(1000);
 *
 * // With estimators and a callback
 * const rule = complexityLimit(
 *   1000,
 *   { estimators: [simpleEstimator({ defaultComplexity: 1 })] },
 *   (complexities) => console.log(complexities),
 * );
 * ```
 */
export const complexityLimit: ComplexityLimitFunction = (
	maxComplexity: number,
	optionsOrCallback?: ComplexityCallback | ComplexityLimitOptions,
	callbackArg?: ComplexityCallback,
): ValidationRule => {
	// Validate maxComplexity
	if (!Number.isFinite(maxComplexity) || maxComplexity <= 0 || !Number.isInteger(maxComplexity)) {
		throw new RangeError(`maxComplexity must be a positive integer, got ${maxComplexity}.`);
	}

	const { callback, options } = normalizeArgs(optionsOrCallback, callbackArg);
	const estimators = options.estimators ?? [
		simpleEstimator({ defaultComplexity: options.defaultComplexity }),
	];

	return (context: ValidationContext): ASTVisitor => {
		// Null-prototype object prevents prototype pollution in callback payload
		const complexities = createNullPrototypeRecord<number>();
		const allocateName = createOperationNameAllocator();

		let hasReportedError = false;

		const config: TraversalConfig = {
			context,
			defaultComplexity: options.defaultComplexity,
			estimators,
			maxComplexity,
			maxNodes: options.maxNodes,
			onCoercionError: options.onCoercionError,
			schema: context.getSchema(),
			variables: options.variables,
		};

		return {
			OperationDefinition(operation: OperationDefinitionNode) {
				// This rule reports only the first error; stop processing once one exists.
				if (hasReportedError) {
					return false;
				}

				let result: ReturnType<typeof calculateComplexity>;
				try {
					result = calculateComplexity(operation, config);
				} catch (error: unknown) {
					hasReportedError = true;
					reportComplexityError(context, operation, error);
					return false;
				}
				const opName = allocateName(operation);
				complexities[opName] = result.complexity;

				if (result.violation && !hasReportedError) {
					hasReportedError = true;

					if (result.violation.kind === "node_count") {
						context.reportError(
							new GraphQLError(
								`Query exceeds maximum node limit of ${result.violation.limit}. ` +
									`This query visited ${result.violation.nodeCount} nodes.`,
								{
									extensions: {
										code: ERROR_CODES.NODE_LIMIT_EXCEEDED,
										limit: result.violation.limit,
										nodeCount: result.violation.nodeCount,
									},
									nodes: [operation],
								},
							),
						);
					} else {
						context.reportError(
							new GraphQLError(
								`Query exceeds maximum complexity of ${maxComplexity}. ` +
									`Actual complexity is ${result.violation.complexity}.`,
								{
									extensions: {
										code: ERROR_CODES.QUERY_TOO_COMPLEX,
										complexity: result.violation.complexity,
										maximumComplexity: maxComplexity,
									},
									nodes: [operation],
								},
							),
						);
					}
				}

				// Skip the built-in visitor traversal; the engine handled it
				return false;
			},

			Document: {
				leave() {
					if (callback && !hasReportedError) {
						try {
							callback(complexities);
						} catch {
							// User-supplied callback failures must not crash the
							// validation pipeline.  The callback is informational;
							// errors inside it are silently discarded.
						}
					}
				},
			},
		};
	};
};

function reportComplexityError(
	context: ValidationContext,
	operation: OperationDefinitionNode,
	error: unknown,
): void {
	if (error instanceof EstimatorExecutionError) {
		context.reportError(
			new GraphQLError(error.message, {
				extensions: {
					code: ERROR_CODES.ESTIMATOR_ERROR,
					estimatorIndex: error.details.estimatorIndex,
					fieldName: error.details.fieldName,
					parentType: error.details.parentType,
				},
				nodes: [operation],
				originalError: error.originalError instanceof Error ? error.originalError : undefined,
			}),
		);
		return;
	}

	if (error instanceof GraphQLError) {
		context.reportError(
			new GraphQLError(error.message, {
				extensions: {
					code: ERROR_CODES.ESTIMATOR_ERROR,
					...(error.extensions ?? {}),
				},
				nodes: [operation],
				originalError: error.originalError instanceof Error ? error.originalError : undefined,
			}),
		);
		return;
	}

	const detail = error instanceof Error ? error.message : String(error);
	context.reportError(
		new GraphQLError(`Failed to evaluate query complexity: ${detail}`, {
			extensions: {
				code: ERROR_CODES.ESTIMATOR_ERROR,
			},
			nodes: [operation],
			originalError: error instanceof Error ? error : undefined,
		}),
	);
}
