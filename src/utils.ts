/**
 * Shared internal helpers used across modules.
 *
 * @internal
 */

/** Create a null-prototype record, avoiding unsafe `as` casts at call sites. */
export function createNullPrototypeRecord<T>(): Record<string, T> {
	return Object.create(null) as Record<string, T>;
}

/** Return a human-readable label for a value's runtime type. */
export function describeValueType(value: unknown): string {
	if (value === null) return "null";
	if (Array.isArray(value)) return "array";
	return typeof value;
}

/** Check whether a value is a plain object (`{}` or null-prototype). */
export function isRecordObject(value: unknown): value is Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return false;
	}
	const prototype = Object.getPrototypeOf(value);
	return prototype === null || prototype === Object.prototype;
}
