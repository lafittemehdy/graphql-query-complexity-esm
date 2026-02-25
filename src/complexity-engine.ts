import {
	type FieldNode,
	type GraphQLCompositeType,
	type GraphQLField,
	type GraphQLNamedType,
	type GraphQLSchema,
	getArgumentValues,
	getNamedType,
	isCompositeType,
	isInterfaceType,
	isObjectType,
	Kind,
	type OperationDefinitionNode,
	type SelectionNode,
	type ValidationContext,
} from "graphql";
import { shouldSkipNode } from "./directives.js";
import type { CoercionErrorInfo, ComplexityEstimator, ComplexityEstimatorArgs } from "./types.js";

// ---------------------------------------------------------------------------
// Public result types
// ---------------------------------------------------------------------------

/** Outcome of a single operation's complexity calculation. */
export interface ComplexityResult {
	/** Total complexity score for the operation. */
	complexity: number;
	/** Number of AST selection nodes visited. */
	nodeCount: number;
	/** Non-null when the operation violates a limit. */
	violation: ComplexityViolation | null;
}

/**
 * Details about a complexity or node-count violation.
 *
 * When `kind` is `"node_count"`, the `complexity` value is `0` because the
 * traversal was aborted before all fields could be evaluated.  Only the
 * `nodeCount` and `limit` fields are meaningful in that case.
 */
export interface ComplexityViolation {
	complexity: number;
	kind: "complexity" | "node_count";
	limit: number;
	nodeCount: number;
}

/** Extra context attached when an estimator throws. */
export interface EstimatorExecutionErrorDetails {
	estimatorIndex: number;
	fieldName: string;
	parentType: string;
}

/**
 * Error thrown when an estimator crashes during complexity calculation.
 * The validation rule converts this into a GraphQL error with
 * `ERROR_CODES.ESTIMATOR_ERROR`.
 */
export class EstimatorExecutionError extends Error {
	constructor(
		public readonly details: EstimatorExecutionErrorDetails,
		public readonly originalError: unknown,
	) {
		super(
			`Estimator #${details.estimatorIndex} failed for ` +
				`${details.parentType}.${details.fieldName}: ` +
				formatThrownValue(originalError),
		);
		this.name = "EstimatorExecutionError";
	}
}

// ---------------------------------------------------------------------------
// Internal stack frame
// ---------------------------------------------------------------------------

/**
 * Context saved when a composite field pushes its children onto the stack.
 * Used to run estimators once all children have been processed.
 */
interface FieldContext {
	args: Record<string, unknown>;
	field: GraphQLField<unknown, unknown>;
	node: FieldNode;
	parentType: GraphQLCompositeType;
}

/**
 * A single frame on the explicit DFS stack.
 *
 * Each frame represents a scope (an operation, a field's children, a fragment
 * expansion, or an inline fragment) whose selections are being iterated.
 */
interface StackFrame {
	/** Accumulated child complexity for this scope. */
	childComplexity: number;
	/**
	 * Non-null when this scope belongs to a composite field.
	 * When the scope completes, estimators run using this context and the
	 * accumulated `childComplexity`.
	 */
	fieldContext: FieldContext | null;
	/** Index of the next selection to process. */
	nextIndex: number;
	/** Type context for resolving field definitions. */
	parentType: GraphQLNamedType | undefined;
	/** The selections being iterated in this scope. */
	selections: readonly SelectionNode[];
	/**
	 * Per-path fragment cycle detection.
	 *
	 * Only {@link processFragmentSpread} creates new copies of this set
	 * (to add the fragment name). {@link processField} and
	 * {@link processInlineFragment} share the parent's reference since
	 * they never mutate visited fragments directly.
	 */
	visitedFragments: Set<string>;
}

// ---------------------------------------------------------------------------
// Immutable traversal configuration
// ---------------------------------------------------------------------------

/** Read-only configuration assembled once per validation run. */
export interface TraversalConfig {
	context: ValidationContext;
	defaultComplexity: number;
	estimators: ComplexityEstimator[];
	maxComplexity: number;
	maxNodes: number;
	onCoercionError?: (info: CoercionErrorInfo) => void;
	schema: GraphQLSchema;
	variables: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Engine entry point
// ---------------------------------------------------------------------------

/**
 * Calculate the complexity of a single operation using an **iterative**
 * post-order DFS traversal.
 *
 * ### Why iterative?
 *
 * Recursive traversal can overflow the call stack on adversarial queries
 * with thousands of aliased fields.  An explicit stack has no such limit.
 *
 * ### Post-order requirement
 *
 * Estimators need `childComplexity` to compute the parent's cost, so we
 * must finish all children before evaluating the parent.  Each
 * {@link StackFrame} accumulates child costs until its selections are
 * exhausted, then bubbles its result to the parent frame.
 *
 * @internal
 */
export function calculateComplexity(
	operation: OperationDefinitionNode,
	config: TraversalConfig,
): ComplexityResult {
	const rootType = resolveRootType(operation, config.schema);
	if (!rootType || !operation.selectionSet) {
		return { complexity: 0, nodeCount: 0, violation: null };
	}

	const stack: StackFrame[] = [
		{
			childComplexity: 0,
			fieldContext: null,
			nextIndex: 0,
			parentType: rootType,
			selections: operation.selectionSet.selections,
			visitedFragments: new Set(),
		},
	];

	let nodeCount = 0;
	let totalComplexity = 0;

	while (stack.length > 0) {
		const frame = stack[stack.length - 1];
		if (!frame) break;

		// ----- Scope complete: bubble result to parent -----------------------
		if (frame.nextIndex >= frame.selections.length) {
			stack.pop();

			const cost = frame.fieldContext
				? runEstimators(
						config.estimators,
						{
							args: frame.fieldContext.args,
							childComplexity: frame.childComplexity,
							field: frame.fieldContext.field,
							node: frame.fieldContext.node,
							type: frame.fieldContext.parentType,
						},
						config.defaultComplexity,
					)
				: frame.childComplexity;

			const parent = stack[stack.length - 1];
			if (parent) {
				parent.childComplexity += cost;
			} else {
				totalComplexity = cost;
			}
			continue;
		}

		// ----- Process next selection ----------------------------------------
		const selection = frame.selections[frame.nextIndex];
		if (!selection) break;
		frame.nextIndex++;
		nodeCount++;

		// Node-count guard
		if (nodeCount > config.maxNodes) {
			return {
				complexity: 0,
				nodeCount,
				violation: {
					complexity: 0,
					kind: "node_count",
					limit: config.maxNodes,
					nodeCount,
				},
			};
		}

		switch (selection.kind) {
			case Kind.FIELD:
				processField(selection, frame, stack, config);
				break;
			case Kind.FRAGMENT_SPREAD:
				processFragmentSpread(selection, frame, stack, config);
				break;
			case Kind.INLINE_FRAGMENT:
				processInlineFragment(selection, frame, stack, config);
				break;
		}
	}

	// Check complexity limit
	const violation: ComplexityViolation | null =
		totalComplexity > config.maxComplexity
			? {
					complexity: totalComplexity,
					kind: "complexity",
					limit: config.maxComplexity,
					nodeCount,
				}
			: null;

	return { complexity: totalComplexity, nodeCount, violation };
}

// ---------------------------------------------------------------------------
// Selection processors
// ---------------------------------------------------------------------------

function processField(
	field: FieldNode,
	frame: StackFrame,
	stack: StackFrame[],
	config: TraversalConfig,
): void {
	if (shouldSkipNode(field, config.variables)) return;
	if (!frame.parentType || !isCompositeType(frame.parentType)) {
		frame.childComplexity += config.defaultComplexity;
		return;
	}

	const fieldDef = resolveFieldDef(field.name.value, frame.parentType);
	if (!fieldDef) {
		frame.childComplexity += config.defaultComplexity;
		return;
	}

	const args = coerceArguments(
		fieldDef,
		field,
		config.variables,
		config.onCoercionError,
		frame.parentType.name,
	);
	const fieldType = getNamedType(fieldDef.type);

	if (field.selectionSet && fieldType && isCompositeType(fieldType)) {
		// Composite field — push its children as a new scope
		stack.push({
			childComplexity: 0,
			fieldContext: {
				args,
				field: fieldDef,
				node: field,
				parentType: frame.parentType,
			},
			nextIndex: 0,
			parentType: fieldType,
			selections: field.selectionSet.selections,
			visitedFragments: frame.visitedFragments,
		});
	} else {
		// Scalar / leaf field — compute cost immediately
		const cost = runEstimators(
			config.estimators,
			{
				args,
				childComplexity: 0,
				field: fieldDef,
				node: field,
				type: frame.parentType,
			},
			config.defaultComplexity,
		);
		frame.childComplexity += cost;
	}
}

function processFragmentSpread(
	spread: SelectionNode & { readonly kind: typeof Kind.FRAGMENT_SPREAD },
	frame: StackFrame,
	stack: StackFrame[],
	config: TraversalConfig,
): void {
	if (shouldSkipNode(spread, config.variables)) return;

	const fragmentName = spread.name.value;
	if (frame.visitedFragments.has(fragmentName)) return;

	const fragment = config.context.getFragment(fragmentName);
	if (!fragment) return;

	const fragmentType = config.schema.getType(fragment.typeCondition.name.value);

	const visited = new Set(frame.visitedFragments);
	visited.add(fragmentName);

	stack.push({
		childComplexity: 0,
		fieldContext: null,
		nextIndex: 0,
		parentType: fragmentType,
		selections: fragment.selectionSet.selections,
		visitedFragments: visited,
	});
}

function processInlineFragment(
	fragment: SelectionNode & { readonly kind: typeof Kind.INLINE_FRAGMENT },
	frame: StackFrame,
	stack: StackFrame[],
	config: TraversalConfig,
): void {
	if (shouldSkipNode(fragment, config.variables)) return;
	if (!fragment.selectionSet) return;

	const inlineType = fragment.typeCondition
		? config.schema.getType(fragment.typeCondition.name.value)
		: frame.parentType;

	stack.push({
		childComplexity: 0,
		fieldContext: null,
		nextIndex: 0,
		parentType: inlineType,
		selections: fragment.selectionSet.selections,
		visitedFragments: frame.visitedFragments,
	});
}

// ---------------------------------------------------------------------------
// Helpers (alphabetical)
// ---------------------------------------------------------------------------

/**
 * Safely coerce field arguments, falling back to `{}` on error.
 *
 * When coercion fails (e.g. due to invalid variable types), multiplier-based
 * estimators will see an empty args object and use a multiplier of `1`.  The
 * optional `onCoercionError` callback is invoked so callers can detect this.
 */
function coerceArguments(
	fieldDef: GraphQLField<unknown, unknown>,
	node: FieldNode,
	variables: Record<string, unknown>,
	onCoercionError?: (info: CoercionErrorInfo) => void,
	parentTypeName?: string,
): Record<string, unknown> {
	try {
		return getArgumentValues(fieldDef, node, variables);
	} catch (error: unknown) {
		onCoercionError?.({
			error,
			fieldName: fieldDef.name,
			parentType: parentTypeName ?? "Unknown",
		});
		return {};
	}
}

/** Format a thrown value into a readable message for error reporting. */
function formatThrownValue(error: unknown): string {
	if (error instanceof Error && error.message) return error.message;
	if (typeof error === "string" && error.length > 0) return error;
	try {
		return JSON.stringify(error);
	} catch {
		return String(error);
	}
}

/** Look up a field definition on a composite type. */
function resolveFieldDef(
	fieldName: string,
	parentType: GraphQLCompositeType,
): GraphQLField<unknown, unknown> | undefined {
	if (isObjectType(parentType) || isInterfaceType(parentType)) {
		return parentType.getFields()[fieldName];
	}
	return undefined;
}

/** Resolve the root type for an operation (Query / Mutation / Subscription). */
function resolveRootType(
	operation: OperationDefinitionNode,
	schema: GraphQLSchema,
): GraphQLNamedType | undefined {
	switch (operation.operation) {
		case "mutation":
			return schema.getMutationType() ?? undefined;
		case "query":
			return schema.getQueryType() ?? undefined;
		case "subscription":
			return schema.getSubscriptionType() ?? undefined;
	}
}

/**
 * Run the estimator chain and return the first non-negative finite result.
 *
 * Negative values are clamped to `0` to prevent complexity-cancellation
 * attacks where a malicious estimator offsets legitimate field costs.
 *
 * Falls back to `defaultCost + childComplexity` when no estimator matches.
 */
function runEstimators(
	estimators: ComplexityEstimator[],
	ctx: ComplexityEstimatorArgs,
	defaultCost: number,
): number {
	for (const [index, estimator] of estimators.entries()) {
		let result: number | undefined;
		try {
			result = estimator(ctx);
		} catch (error: unknown) {
			throw new EstimatorExecutionError(
				{
					estimatorIndex: index,
					fieldName: ctx.field.name,
					parentType: ctx.type.name,
				},
				error,
			);
		}
		if (typeof result === "number" && Number.isFinite(result)) {
			return Math.min(Math.max(0, result), Number.MAX_SAFE_INTEGER);
		}
	}
	return defaultCost + ctx.childComplexity;
}
