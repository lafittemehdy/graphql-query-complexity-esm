import { buildSchema } from "graphql";
import { describe, expect, it } from "vitest";
import { fieldExtensionsEstimator, simpleEstimator } from "../estimators.js";
import { directiveSchema, measureComplexity, multiMultiplierSchema } from "./fixtures.js";

describe("simpleEstimator", () => {
	it("should assign defaultComplexity to each field", () => {
		const { complexity } = measureComplexity(directiveSchema, "query { simple }", {
			estimators: [simpleEstimator({ defaultComplexity: 3 })],
		});
		expect(complexity).toBe(3);
	});

	it("should default to 1 when no options given", () => {
		const { complexity } = measureComplexity(directiveSchema, "query { simple }", {
			estimators: [simpleEstimator()],
		});
		expect(complexity).toBe(1);
	});

	it("should add childComplexity", () => {
		const { complexity } = measureComplexity(directiveSchema, "query { posts { id } }", {
			estimators: [simpleEstimator({ defaultComplexity: 2 })],
		});
		// posts: 2 + id(2) = 4
		expect(complexity).toBe(4);
	});

	it("should throw for invalid defaultComplexity values", () => {
		expect(() => simpleEstimator({ defaultComplexity: Number.NaN })).toThrow(RangeError);
		expect(() => simpleEstimator({ defaultComplexity: Number.POSITIVE_INFINITY })).toThrow(
			RangeError,
		);
		expect(() => simpleEstimator({ defaultComplexity: -1 })).toThrow(RangeError);
	});
});

describe("fieldExtensionsEstimator", () => {
	const estimators = [fieldExtensionsEstimator(), simpleEstimator()];

	describe("@complexity directive", () => {
		it("should use value from directive without multipliers", () => {
			const { complexity } = measureComplexity(directiveSchema, "query { posts { id } }", {
				estimators,
			});
			// posts(@complexity value=10) + id(1) = 10 + 1 = 11
			// fieldExtensionsEstimator returns base + multiplier * childComplexity = 10 + 1 * 1 = 11
			expect(complexity).toBe(11);
		});

		it("should apply single multiplier argument", () => {
			const { complexity } = measureComplexity(
				directiveSchema,
				"query { users(limit: 5) { id name } }",
				{ estimators },
			);
			// child = id(1) + name(1) = 2
			// users = value(2) + limit(5) * child(2) = 2 + 10 = 12
			expect(complexity).toBe(12);
		});

		it("should apply multiple multiplier arguments", () => {
			const { complexity } = measureComplexity(
				multiMultiplierSchema,
				"query { items(limit: 4, take: 3) { id } }",
				{ estimators },
			);
			// child = id(1)
			// items = value(5) + (4*3)(12) * child(1) = 5 + 12 = 17
			expect(complexity).toBe(17);
		});

		it("should use multiplier of 1 when multiplier args are missing", () => {
			const { complexity } = measureComplexity(directiveSchema, "query { users { id } }", {
				estimators,
			});
			// child = id(1)
			// users = value(2) + 1 * 1 = 3
			expect(complexity).toBe(3);
		});

		it("should use child cost for @complexity fields with children", () => {
			const { complexity } = measureComplexity(directiveSchema, "query { posts { id title } }", {
				estimators,
			});
			// posts: value(10) + 1 * (id(1) + title(5)) = 10 + 6 = 16
			expect(complexity).toBe(16);
		});

		it("should return undefined for fields without directive", () => {
			const { complexity } = measureComplexity(directiveSchema, "query { simple }", {
				estimators: [fieldExtensionsEstimator(), simpleEstimator({ defaultComplexity: 7 })],
			});
			// Falls through to simpleEstimator
			expect(complexity).toBe(7);
		});
	});

	describe("non-numeric extensions.complexity", () => {
		it("should fall through to directive when extensions.complexity is a string", () => {
			const schema = buildSchema(`
				directive @complexity(value: Int!, multipliers: [String!]) on FIELD_DEFINITION
				type Query { items: [Item!]! @complexity(value: 8) }
				type Item { id: ID! }
			`);
			const fields = schema.getQueryType()?.getFields();
			// @ts-expect-error - intentionally set invalid type
			fields.items.extensions = { complexity: "10" };

			const { complexity } = measureComplexity(schema, "query { items { id } }", {
				estimators,
			});
			// Directive value(8) + 1 * id(1) = 9
			expect(complexity).toBe(9);
		});

		it("should fall through to directive when extensions.complexity is a boolean", () => {
			const schema = buildSchema(`
				directive @complexity(value: Int!, multipliers: [String!]) on FIELD_DEFINITION
				type Query { items: [Item!]! @complexity(value: 3) }
				type Item { id: ID! }
			`);
			const fields = schema.getQueryType()?.getFields();
			// @ts-expect-error - intentionally set invalid type
			fields.items.extensions = { complexity: true };

			const { complexity } = measureComplexity(schema, "query { items { id } }", {
				estimators,
			});
			// Directive value(3) + 1 * id(1) = 4
			expect(complexity).toBe(4);
		});

		it("should fall through when extensions.complexity.value is NaN", () => {
			const schema = buildSchema(`
				directive @complexity(value: Int!, multipliers: [String!]) on FIELD_DEFINITION
				type Query { items: [Item!]! @complexity(value: 6) }
				type Item { id: ID! }
			`);
			const fields = schema.getQueryType()?.getFields();
			// @ts-expect-error - intentionally set invalid type
			fields.items.extensions = { complexity: { value: Number.NaN } };

			const { complexity } = measureComplexity(schema, "query { items { id } }", {
				estimators,
			});
			// Invalid config falls through; directive value(6) + id(1) = 7
			expect(complexity).toBe(7);
		});

		it("should fall through when multipliers contain non-strings", () => {
			const schema = buildSchema(`
				directive @complexity(value: Int!, multipliers: [String!]) on FIELD_DEFINITION
				type Query { items: [Item!]! @complexity(value: 4) }
				type Item { id: ID! }
			`);
			const fields = schema.getQueryType()?.getFields();
			// @ts-expect-error - intentionally invalid multipliers for runtime guard testing
			fields.items.extensions = { complexity: { value: 100, multipliers: [123] } };

			const { complexity } = measureComplexity(schema, "query { items { id } }", {
				estimators,
			});
			// Invalid extension config falls through; directive value(4) + id(1) = 5
			expect(complexity).toBe(5);
		});
	});

	describe("multiplier edge cases", () => {
		it("should ignore negative multiplier argument values", () => {
			const { complexity } = measureComplexity(
				directiveSchema,
				"query { users(limit: -5) { id name } }",
				{ estimators },
			);
			// Negative limit is ignored, multiplier stays at 1
			// child = id(1) + name(1) = 2
			// users = value(2) + 1 * child(2) = 2 + 2 = 4
			expect(complexity).toBe(4);
		});

		it("should ignore zero multiplier argument values", () => {
			const { complexity } = measureComplexity(
				directiveSchema,
				"query { users(limit: 0) { id name } }",
				{ estimators },
			);
			// Zero limit is ignored (not > 0), multiplier stays at 1
			// child = id(1) + name(1) = 2
			// users = value(2) + 1 * child(2) = 2 + 2 = 4
			expect(complexity).toBe(4);
		});

		it("should clamp multiplier product to MAX_SAFE_INTEGER", () => {
			const schema = buildSchema(`
				directive @complexity(value: Int!, multipliers: [String!]) on FIELD_DEFINITION
				type Query {
					items(a: Int, b: Int): [Item!]!
						@complexity(value: 0, multipliers: ["a", "b"])
				}
				type Item { id: ID! }
			`);

			const { complexity } = measureComplexity(
				schema,
				"query { items(a: 999999999999, b: 999999999999) { id } }",
				{ estimators },
			);
			// Product would overflow; clamped to MAX_SAFE_INTEGER
			// items = 0 + MAX_SAFE_INTEGER * 1 = MAX_SAFE_INTEGER
			expect(complexity).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER);
			expect(complexity).toBeGreaterThan(0);
		});
	});

	describe("programmatic extensions", () => {
		it("should use extensions.complexity as base cost", () => {
			const schema = buildSchema(`
				type Query { items: [Item!]! }
				type Item { id: ID! }
			`);
			const fields = schema.getQueryType()?.getFields();
			// @ts-expect-error - manually add extensions for testing
			fields.items.extensions = { complexity: 20 };

			const { complexity } = measureComplexity(schema, "query { items { id } }", {
				estimators,
			});
			// items: 20 + id(1) = 21
			expect(complexity).toBe(21);
		});

		it("should prefer extensions over directive when both present", () => {
			const schema = buildSchema(`
				directive @complexity(value: Int!, multipliers: [String!]) on FIELD_DEFINITION
				type Query { items: [Item!]! @complexity(value: 5) }
				type Item { id: ID! }
			`);
			const fields = schema.getQueryType()?.getFields();
			// @ts-expect-error - manually add extensions for testing
			fields.items.extensions = { complexity: 100 };

			const { complexity } = measureComplexity(schema, "query { items { id } }", {
				estimators,
			});
			// extensions.complexity(100) + id(1) = 101
			expect(complexity).toBe(101);
		});

		it("should support object form with multipliers", () => {
			const schema = buildSchema(`
				type Query { items(limit: Int): [Item!]! }
				type Item { id: ID! }
			`);
			const fields = schema.getQueryType()?.getFields();
			// @ts-expect-error - manually add extensions for testing
			fields.items.extensions = { complexity: { value: 3, multipliers: ["limit"] } };

			const { complexity } = measureComplexity(schema, "query { items(limit: 5) { id } }", {
				estimators,
			});
			// items: value(3) + limit(5) * id(1) = 3 + 5 = 8
			expect(complexity).toBe(8);
		});

		it("should support object form without multipliers", () => {
			const schema = buildSchema(`
				type Query { items: [Item!]! }
				type Item { id: ID! }
			`);
			const fields = schema.getQueryType()?.getFields();
			// @ts-expect-error - manually add extensions for testing
			fields.items.extensions = { complexity: { value: 15 } };

			const { complexity } = measureComplexity(schema, "query { items { id } }", {
				estimators,
			});
			// items: value(15) + 1 * id(1) = 15 + 1 = 16
			expect(complexity).toBe(16);
		});
	});
});
