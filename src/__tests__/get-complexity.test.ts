import { parse } from "graphql";
import { describe, expect, it } from "vitest";
import { ERROR_CODES } from "../constants.js";
import { fieldExtensionsEstimator, simpleEstimator } from "../estimators.js";
import { getComplexity, getComplexityBreakdown } from "../get-complexity.js";
import { QueryComplexityValidationError } from "../types.js";
import { basicSchema, directiveSchema } from "./fixtures.js";

describe("getComplexity", () => {
	it("should calculate complexity for a simple query string", () => {
		const cost = getComplexity({
			estimators: [simpleEstimator()],
			query: 'query { user(id: "1") { id name } }',
			schema: basicSchema,
		});
		// user(1) + id(1) + name(1) = 3
		expect(cost).toBe(3);
	});

	it("should calculate complexity for a nested query", () => {
		const cost = getComplexity({
			estimators: [simpleEstimator()],
			query: 'query { user(id: "1") { id posts { id title } } }',
			schema: basicSchema,
		});
		expect(cost).toBe(5);
	});

	it("should accept a DocumentNode", () => {
		const doc = parse('query { user(id: "1") { id } }');
		const cost = getComplexity({
			estimators: [simpleEstimator()],
			query: doc,
			schema: basicSchema,
		});
		expect(cost).toBe(2);
	});

	it("should handle variables", () => {
		const cost = getComplexity({
			estimators: [
				({ args, childComplexity }) => {
					if (typeof args.limit === "number") {
						return args.limit * (1 + childComplexity);
					}
					return undefined;
				},
				simpleEstimator(),
			],
			query: `query($l: Int!) { users(limit: $l) { id name } }`,
			schema: basicSchema,
			variables: { l: 10 },
		});
		// users: 10 * (1 + 2) = 30
		expect(cost).toBe(30);
	});

	it("should handle fragments", () => {
		const cost = getComplexity({
			estimators: [simpleEstimator()],
			query: `
				fragment F on User { id name }
				query { user(id: "1") { ...F } }
			`,
			schema: basicSchema,
		});
		expect(cost).toBe(3);
	});

	it("should handle @skip and @include", () => {
		const cost = getComplexity({
			estimators: [simpleEstimator()],
			query: 'query { user(id: "1") { id name @skip(if: true) } }',
			schema: basicSchema,
		});
		expect(cost).toBe(2);
	});

	it("should keep traversal stable when directive variable coercion fails", () => {
		const cost = getComplexity({
			estimators: [simpleEstimator()],
			query: 'query($s: Boolean!) { user(id: "1") { id name @skip(if: $s) } }',
			schema: basicSchema,
		});
		// Missing runtime variable value means skip cannot be resolved; field is treated as included.
		expect(cost).toBe(3);
	});

	it("should work with custom estimators", () => {
		const cost = getComplexity({
			estimators: [
				({ args, childComplexity }) => {
					const limit = typeof args.limit === "number" ? args.limit : 1;
					return limit * (1 + childComplexity);
				},
			],
			query: `query {
				users(limit: 5) {
					id
					posts(limit: 3) { title }
				}
			}`,
			schema: basicSchema,
		});
		// posts: 3 * (1 + title(1)) = 6
		// users: 5 * (1 + id(1) + posts(6)) = 5 * 8 = 40
		expect(cost).toBe(40);
	});

	it("should work with fieldExtensionsEstimator", () => {
		const cost = getComplexity({
			estimators: [fieldExtensionsEstimator(), simpleEstimator()],
			query: "query { posts { id title } }",
			schema: directiveSchema,
		});
		// posts(10 + 1*(id(1)+title(5))) = 10 + 6 = 16
		expect(cost).toBe(16);
	});

	// -------------------------------------------------------------------
	// Breakdown API
	// -------------------------------------------------------------------
	describe("getComplexityBreakdown", () => {
		it("should return per-operation complexity map", () => {
			const breakdown = getComplexityBreakdown({
				estimators: [simpleEstimator()],
				query: `
					query A { users { id } }
					query B { users { id name } }
				`,
				schema: basicSchema,
			});

			expect(breakdown.A).toBe(2);
			expect(breakdown.B).toBe(3);
		});

		it("should freeze the returned map", () => {
			const breakdown = getComplexityBreakdown({
				estimators: [simpleEstimator()],
				query: "query { users { id } }",
				schema: basicSchema,
			});

			expect(Object.isFrozen(breakdown)).toBe(true);
		});

		it("should throw QueryComplexityValidationError for invalid query syntax", () => {
			expect(() =>
				getComplexityBreakdown({
					estimators: [simpleEstimator()],
					query: "query {",
					schema: basicSchema,
				}),
			).toThrow(QueryComplexityValidationError);
		});
	});

	// -------------------------------------------------------------------
	// Multi-operation documents
	// -------------------------------------------------------------------
	describe("multi-operation documents", () => {
		it("should return the maximum complexity across operations", () => {
			const cost = getComplexity({
				estimators: [simpleEstimator()],
				query: `
					query A { users { id } }
					query B { users { id name } }
				`,
				schema: basicSchema,
			});
			// A: users(1) + id(1) = 2
			// B: users(1) + id(1) + name(1) = 3
			// max(2, 3) = 3
			expect(cost).toBe(3);
		});

		it("should return the single operation cost for single-operation documents", () => {
			const cost = getComplexity({
				estimators: [simpleEstimator()],
				query: "query { users { id name } }",
				schema: basicSchema,
			});
			// users(1) + id(1) + name(1) = 3
			expect(cost).toBe(3);
		});
	});

	// -------------------------------------------------------------------
	// maxNodes
	// -------------------------------------------------------------------
	describe("maxNodes", () => {
		it("should reject queries exceeding maxNodes", () => {
			expect(() =>
				getComplexity({
					estimators: [simpleEstimator()],
					maxNodes: 3,
					query: 'query { user(id: "1") { id name posts { id } } }',
					schema: basicSchema,
				}),
			).toThrow(QueryComplexityValidationError);
		});

		it("should include NODE_LIMIT_EXCEEDED code in the error", () => {
			try {
				getComplexity({
					estimators: [simpleEstimator()],
					maxNodes: 2,
					query: 'query { user(id: "1") { id name } }',
					schema: basicSchema,
				});
				expect.fail("Should have thrown");
			} catch (error) {
				expect(error).toBeInstanceOf(QueryComplexityValidationError);
				const qcve = error as QueryComplexityValidationError;
				expect(qcve.errors[0]?.extensions?.code).toBe(ERROR_CODES.NODE_LIMIT_EXCEEDED);
			}
		});

		it("should allow queries within the maxNodes limit", () => {
			const cost = getComplexity({
				estimators: [simpleEstimator()],
				maxNodes: 10,
				query: 'query { user(id: "1") { id name } }',
				schema: basicSchema,
			});
			expect(cost).toBe(3);
		});
	});

	// -------------------------------------------------------------------
	// Error handling
	// -------------------------------------------------------------------
	describe("error handling", () => {
		it("should throw when schema is not a GraphQLSchema instance", () => {
			expect(() =>
				getComplexity({
					estimators: [simpleEstimator()],
					query: "query { users { id } }",
					schema: {} as unknown as typeof basicSchema,
				}),
			).toThrow(TypeError);
		});

		it("should throw when estimators is empty", () => {
			expect(() =>
				getComplexity({
					estimators: [],
					query: "query { users { id } }",
					schema: basicSchema,
				}),
			).toThrow(TypeError);
		});

		it("should throw when options is not a plain object", () => {
			expect(() => getComplexity(null as unknown as Parameters<typeof getComplexity>[0])).toThrow(
				TypeError,
			);
			expect(() => getComplexity([] as unknown as Parameters<typeof getComplexity>[0])).toThrow(
				TypeError,
			);
		});

		it("should throw when query is not a string or DocumentNode", () => {
			expect(() =>
				getComplexity({
					estimators: [simpleEstimator()],
					query: 123 as unknown as string,
					schema: basicSchema,
				}),
			).toThrow(TypeError);
		});

		it("should throw when an estimator is not a function", () => {
			expect(() =>
				getComplexity({
					estimators: [42 as unknown as () => undefined],
					query: "query { users { id } }",
					schema: basicSchema,
				}),
			).toThrow(TypeError);
		});

		it("should throw when maxNodes is invalid", () => {
			expect(() =>
				getComplexity({
					estimators: [simpleEstimator()],
					maxNodes: 0,
					query: "query { users { id } }",
					schema: basicSchema,
				}),
			).toThrow(RangeError);
			expect(() =>
				getComplexity({
					estimators: [simpleEstimator()],
					maxNodes: 1.5,
					query: "query { users { id } }",
					schema: basicSchema,
				}),
			).toThrow(RangeError);
		});

		it("should throw when variables is not a plain object", () => {
			expect(() =>
				getComplexity({
					estimators: [simpleEstimator()],
					query: "query { users { id } }",
					schema: basicSchema,
					variables: [] as unknown as Record<string, unknown>,
				}),
			).toThrow(TypeError);
		});

		it("should wrap syntax errors in QueryComplexityValidationError", () => {
			try {
				getComplexity({
					estimators: [simpleEstimator()],
					query: "query {",
					schema: basicSchema,
				});
				expect.fail("Should have thrown");
			} catch (error) {
				expect(error).toBeInstanceOf(QueryComplexityValidationError);
				const qcve = error as QueryComplexityValidationError;
				expect(qcve.errors[0]?.message).toContain("Syntax Error");
			}
		});

		it("should throw QueryComplexityValidationError for invalid queries", () => {
			expect(() =>
				getComplexity({
					estimators: [simpleEstimator()],
					query: "query { nonExistentField }",
					schema: basicSchema,
				}),
			).toThrow(QueryComplexityValidationError);
		});

		it("should include GraphQLError instances in the error", () => {
			try {
				getComplexity({
					estimators: [simpleEstimator()],
					query: "query { nonExistentField }",
					schema: basicSchema,
				});
				expect.fail("Should have thrown");
			} catch (error) {
				expect(error).toBeInstanceOf(QueryComplexityValidationError);
				const qcve = error as QueryComplexityValidationError;
				expect(qcve.errors).toBeInstanceOf(Array);
				expect(qcve.errors.length).toBeGreaterThan(0);
				expect(qcve.name).toBe("QueryComplexityValidationError");
			}
		});

		it("should surface estimator runtime failures as validation errors", () => {
			try {
				getComplexity({
					estimators: [
						() => {
							throw new Error("boom");
						},
					],
					query: 'query { user(id: "1") { id } }',
					schema: basicSchema,
				});
				expect.fail("Should have thrown");
			} catch (error) {
				expect(error).toBeInstanceOf(QueryComplexityValidationError);
				const qcve = error as QueryComplexityValidationError;
				expect(qcve.errors[0]?.extensions?.code).toBe(ERROR_CODES.ESTIMATOR_ERROR);
				expect(qcve.errors[0]?.message).toContain("boom");
			}
		});
	});
});
