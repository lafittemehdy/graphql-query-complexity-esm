import type { GraphQLField } from "graphql";
import type { ComplexityEstimator, ComplexityExtensionConfig } from "./types.js";
import { isRecordObject } from "./utils.js";

// ---------------------------------------------------------------------------
// Shared helpers (alphabetical)
// ---------------------------------------------------------------------------

/**
 * Calculate field cost from a base value, optional argument multipliers,
 * and accumulated child complexity.
 *
 * Formula: `base + multiplierProduct * childComplexity`
 */
function calculateFieldCost(
	args: Record<string, unknown>,
	base: number,
	childComplexity: number,
	multipliers?: readonly string[],
): number {
	let multiplier = 1;
	if (multipliers) {
		for (const name of multipliers) {
			const argValue = args[name];
			if (typeof argValue === "number" && Number.isFinite(argValue)) {
				multiplier *= argValue;
			}
		}
	}
	return base + multiplier * childComplexity;
}

/** Type guard for the object form of `extensions.complexity`. */
function isComplexityConfig(value: unknown): value is ComplexityExtensionConfig {
	if (!isRecordObject(value)) return false;
	if (typeof value.value !== "number" || !Number.isFinite(value.value)) {
		return false;
	}
	const { multipliers } = value;
	if (multipliers === undefined) return true;
	if (!Array.isArray(multipliers)) return false;
	for (const item of multipliers) {
		if (typeof item !== "string") return false;
	}
	return true;
}

interface ParsedDirectiveComplexityConfig {
	multipliers?: readonly string[];
	value: number;
}

function parseDirectiveComplexityConfig(
	field: GraphQLField<unknown, unknown>,
): ParsedDirectiveComplexityConfig | null {
	if (!field.astNode?.directives) return null;
	const directive = field.astNode.directives.find((d) => d.name.value === "complexity");
	if (!directive?.arguments) return null;

	const valueArg = directive.arguments.find((a) => a.name.value === "value");
	if (valueArg?.value.kind !== "IntValue") return null;

	const value = Number.parseInt(valueArg.value.value, 10);
	if (!Number.isFinite(value)) return null;

	const multipliersArg = directive.arguments.find((a) => a.name.value === "multipliers");
	if (multipliersArg?.value.kind !== "ListValue") {
		return { value };
	}

	const multipliers: string[] = [];
	for (const item of multipliersArg.value.values) {
		if (item.kind === "StringValue") {
			multipliers.push(item.value);
		}
	}

	return multipliers.length > 0 ? { multipliers, value } : { value };
}

function getCachedDirectiveComplexityConfig(
	field: GraphQLField<unknown, unknown>,
	cache: WeakMap<GraphQLField<unknown, unknown>, ParsedDirectiveComplexityConfig | null>,
): ParsedDirectiveComplexityConfig | null {
	if (cache.has(field)) {
		return cache.get(field) ?? null;
	}

	const parsed = parseDirectiveComplexityConfig(field);
	cache.set(field, parsed);
	return parsed;
}

// ---------------------------------------------------------------------------
// Estimators (alphabetical)
// ---------------------------------------------------------------------------

/**
 * Estimator that reads cost from the `@complexity` schema directive or
 * from the field's programmatic `extensions.complexity` property.
 *
 * ### Directive format
 *
 * ```graphql
 * directive @complexity(value: Int!, multipliers: [String!]) on FIELD_DEFINITION
 *
 * type Query {
 *   users(limit: Int): [User!]! @complexity(value: 2, multipliers: ["limit"])
 * }
 * ```
 *
 * - `value` — base cost added to the field.
 * - `multipliers` — optional list of argument names whose runtime values
 *   are multiplied together and then applied to the child complexity.
 *
 * ### Programmatic extensions
 *
 * ```typescript
 * // Simple: flat number (base cost, child complexity added on top)
 * field.extensions = { complexity: 10 };
 *
 * // Advanced: object with multipliers (same behavior as the directive)
 * field.extensions = { complexity: { value: 2, multipliers: ["limit"] } };
 * ```
 *
 * When `extensions.complexity` is a finite number it is treated as the base
 * cost and child complexity is added on top.
 *
 * When `extensions.complexity` is a {@link ComplexityExtensionConfig} object
 * it behaves identically to the `@complexity` directive.
 *
 * @returns A {@link ComplexityEstimator} function.
 *
 * @example
 * ```typescript
 * const estimators = [
 *   fieldExtensionsEstimator(),
 *   simpleEstimator({ defaultComplexity: 1 }),
 * ];
 * ```
 */
export function fieldExtensionsEstimator(): ComplexityEstimator {
	const directiveConfigCache = new WeakMap<
		GraphQLField<unknown, unknown>,
		ParsedDirectiveComplexityConfig | null
	>();

	return ({ args, childComplexity, field }) => {
		const ext = field.extensions?.complexity;

		// --- Programmatic extensions cost (takes priority) ------------------
		if (typeof ext === "number" && Number.isFinite(ext)) {
			return ext + childComplexity;
		}

		if (isComplexityConfig(ext)) {
			return calculateFieldCost(args, ext.value, childComplexity, ext.multipliers);
		}

		// --- Directive-based cost -------------------------------------------
		const directiveConfig = getCachedDirectiveComplexityConfig(field, directiveConfigCache);
		if (directiveConfig) {
			return calculateFieldCost(
				args,
				directiveConfig.value,
				childComplexity,
				directiveConfig.multipliers,
			);
		}

		// Defer to next estimator
		return undefined;
	};
}

/**
 * Simple estimator that assigns a **fixed base cost** to every field and
 * adds child complexity on top.
 *
 * Best used as a **fallback** after more specific estimators:
 *
 * ```typescript
 * const estimators = [
 *   fieldExtensionsEstimator(),
 *   simpleEstimator({ defaultComplexity: 1 }),
 * ];
 * ```
 *
 * > **Note:** This estimator does **not** account for list multipliers.
 * > Fields returning lists (e.g. `users(limit: 100)`) will receive the same
 * > cost as scalar fields.  Combine with a custom estimator or the
 * > `@complexity` directive for accurate list costing.
 *
 * @param options.defaultComplexity - Base cost per field (default `1`).
 */
export function simpleEstimator(options: { defaultComplexity?: number } = {}): ComplexityEstimator {
	const cost = options.defaultComplexity ?? 1;
	if (!Number.isFinite(cost) || cost < 0) {
		throw new RangeError(
			`simpleEstimator defaultComplexity must be a non-negative finite number, got ${cost}.`,
		);
	}
	return ({ childComplexity }) => cost + childComplexity;
}
