import type { ComplexityEstimator } from "./types.js";
import { describeValueType, isRecordObject } from "./utils.js";

/**
 * Validates an options object shape.
 */
export function assertOptionsObject(value: unknown): asserts value is Record<string, unknown> {
	if (!isRecordObject(value)) {
		throw new TypeError(`Expected options to be a plain object, got ${describeValueType(value)}.`);
	}
}

/**
 * Validates that a named value is a plain object.
 */
export function assertPlainObjectValue(
	value: unknown,
	name: string,
): asserts value is Record<string, unknown> {
	if (!isRecordObject(value)) {
		throw new TypeError(`${name} must be a plain object, got ${describeValueType(value)}.`);
	}
}

/**
 * Validates estimator arrays and their entries.
 */
export function assertEstimatorArray(
	estimators: unknown,
	describeEntryType: (value: unknown) => string = describeValueType,
): asserts estimators is ComplexityEstimator[] {
	if (!Array.isArray(estimators) || estimators.length === 0) {
		throw new TypeError("estimators must be a non-empty array of functions.");
	}

	for (const estimator of estimators) {
		if (typeof estimator !== "function") {
			throw new TypeError(
				`Every estimator must be a function, got ${describeEntryType(estimator)}.`,
			);
		}
	}
}
