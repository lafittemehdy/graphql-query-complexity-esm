import { describe, expect, it } from "vitest";
import { createNullPrototypeRecord, describeValueType, isRecordObject } from "../utils.js";

describe("createNullPrototypeRecord", () => {
	it("should return an object with null prototype", () => {
		const record = createNullPrototypeRecord<number>();
		expect(Object.getPrototypeOf(record)).toBeNull();
	});

	it("should return an empty record", () => {
		const record = createNullPrototypeRecord<string>();
		expect(Object.keys(record)).toHaveLength(0);
	});

	it("should be writable as a normal record", () => {
		const record = createNullPrototypeRecord<number>();
		record.key = 42;
		expect(record.key).toBe(42);
	});
});

describe("describeValueType", () => {
	it("should return 'null' for null", () => {
		expect(describeValueType(null)).toBe("null");
	});

	it("should return 'array' for arrays", () => {
		expect(describeValueType([])).toBe("array");
		expect(describeValueType([1, 2, 3])).toBe("array");
	});

	it("should return 'object' for plain objects", () => {
		expect(describeValueType({})).toBe("object");
		expect(describeValueType({ key: "value" })).toBe("object");
	});

	it("should return 'string' for strings", () => {
		expect(describeValueType("hello")).toBe("string");
		expect(describeValueType("")).toBe("string");
	});

	it("should return 'number' for numbers", () => {
		expect(describeValueType(42)).toBe("number");
		expect(describeValueType(0)).toBe("number");
		expect(describeValueType(Number.NaN)).toBe("number");
	});

	it("should return 'boolean' for booleans", () => {
		expect(describeValueType(true)).toBe("boolean");
		expect(describeValueType(false)).toBe("boolean");
	});

	it("should return 'undefined' for undefined", () => {
		expect(describeValueType(undefined)).toBe("undefined");
	});

	it("should return 'function' for functions", () => {
		expect(describeValueType(() => {})).toBe("function");
	});

	it("should return 'symbol' for symbols", () => {
		expect(describeValueType(Symbol("test"))).toBe("symbol");
	});

	it("should return 'bigint' for bigints", () => {
		expect(describeValueType(1n)).toBe("bigint");
	});
});

describe("isRecordObject", () => {
	it("should return true for plain objects", () => {
		expect(isRecordObject({})).toBe(true);
		expect(isRecordObject({ a: 1 })).toBe(true);
	});

	it("should return true for null-prototype objects", () => {
		expect(isRecordObject(Object.create(null))).toBe(true);
	});

	it("should return false for null", () => {
		expect(isRecordObject(null)).toBe(false);
	});

	it("should return false for arrays", () => {
		expect(isRecordObject([])).toBe(false);
		expect(isRecordObject([1, 2])).toBe(false);
	});

	it("should return false for non-plain objects", () => {
		expect(isRecordObject(new Date())).toBe(false);
		expect(isRecordObject(new Map())).toBe(false);

		class Custom {}
		expect(isRecordObject(new Custom())).toBe(false);
	});

	it("should return false for primitives", () => {
		expect(isRecordObject("string")).toBe(false);
		expect(isRecordObject(42)).toBe(false);
		expect(isRecordObject(true)).toBe(false);
		expect(isRecordObject(undefined)).toBe(false);
	});
});
