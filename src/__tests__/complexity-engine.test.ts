import { describe, expect, it, vi } from "vitest";
import { fieldExtensionsEstimator, simpleEstimator } from "../estimators.js";
import {
	abstractSchema,
	basicSchema,
	directiveSchema,
	measureComplexity,
	multiMultiplierSchema,
} from "./fixtures.js";

describe("complexity-engine", () => {
	// -------------------------------------------------------------------
	// Core calculation
	// -------------------------------------------------------------------
	describe("core calculation", () => {
		it("should return 1 for a single scalar field", () => {
			const { complexity } = measureComplexity(basicSchema, "query { __typename }");
			expect(complexity).toBe(1);
		});

		it("should sum scalar field costs", () => {
			const { complexity } = measureComplexity(basicSchema, 'query { user(id: "1") { id name } }');
			// user(1) + id(1) + name(1) = 3
			expect(complexity).toBe(3);
		});

		it("should add nested composite field costs", () => {
			const { complexity } = measureComplexity(
				basicSchema,
				'query { user(id: "1") { id posts { id title } } }',
			);
			// user(1) + id(1) + posts(1) + posts.id(1) + posts.title(1) = 5
			expect(complexity).toBe(5);
		});

		it("should handle deeply nested queries", () => {
			const { complexity } = measureComplexity(
				basicSchema,
				`query {
					user(id: "1") {
						posts {
							comments {
								author { id name }
							}
						}
					}
				}`,
			);
			// user(1) + posts(1) + comments(1) + author(1) + id(1) + name(1) = 6
			expect(complexity).toBe(6);
		});
	});

	// -------------------------------------------------------------------
	// Fragment handling
	// -------------------------------------------------------------------
	describe("fragments", () => {
		it("should expand named fragments and sum costs", () => {
			const { complexity } = measureComplexity(
				basicSchema,
				`fragment F on User { id name }
				query { user(id: "1") { ...F } }`,
			);
			// user(1) + id(1) + name(1) = 3
			expect(complexity).toBe(3);
		});

		it("should handle inline fragments on concrete types", () => {
			const { complexity } = measureComplexity(
				basicSchema,
				`query { user(id: "1") { ... on User { id name } } }`,
			);
			expect(complexity).toBe(3);
		});

		it("should handle inline fragments on interfaces", () => {
			const { complexity } = measureComplexity(
				abstractSchema,
				`query {
					search(term: "x") {
						... on Post { id title }
						... on User { id name }
					}
				}`,
			);
			// search(1) + id(1) + title(1) + id(1) + name(1) = 5
			expect(complexity).toBe(5);
		});

		it("should detect fragment cycles (per-path)", () => {
			const { complexity } = measureComplexity(
				basicSchema,
				`fragment Rec on User {
					id
					friends { ...Rec }
				}
				query { user(id: "1") { ...Rec } }`,
			);
			// user(1) + id(1) + friends(1) (cycle stops) = 3
			expect(complexity).toBe(3);
		});

		it("should reuse fragments across parallel branches", () => {
			const { complexity } = measureComplexity(
				basicSchema,
				`fragment Basic on User { id name }
				query {
					user(id: "1") {
						...Basic
						posts { author { ...Basic } }
					}
				}`,
			);
			// user(1) + id(1) + name(1) + posts(1) + author(1) + id(1) + name(1) = 7
			expect(complexity).toBe(7);
		});

		it("should handle nested named fragments", () => {
			const { complexity } = measureComplexity(
				basicSchema,
				`fragment PostF on Post { id title }
				fragment UserF on User { id posts { ...PostF } }
				query { user(id: "1") { ...UserF } }`,
			);
			// user(1) + id(1) + posts(1) + id(1) + title(1) = 5
			expect(complexity).toBe(5);
		});
	});

	// -------------------------------------------------------------------
	// Estimator chain
	// -------------------------------------------------------------------
	describe("estimator chain", () => {
		it("should use the first estimator that returns a number", () => {
			const est1 = vi.fn(() => undefined);
			const est2 = vi.fn(() => 42);
			const est3 = vi.fn(() => 99);

			const { complexity } = measureComplexity(basicSchema, 'query { user(id: "1") { id } }', {
				estimators: [est1, est2, est3],
			});

			expect(est1).toHaveBeenCalled();
			expect(est2).toHaveBeenCalled();
			expect(est3).not.toHaveBeenCalled();
			// est2 returns 42 for every field (ignoring childComplexity).
			// id:   est1 → undefined, est2 → 42
			// user: est1 → undefined, est2 → 42 (childComplexity=42, but est2 ignores it)
			// Total: 42
			expect(complexity).toBe(42);
		});

		it("should pass correct childComplexity to estimators", () => {
			const received: number[] = [];
			const est = ({ childComplexity }: { childComplexity: number }) => {
				received.push(childComplexity);
				return 1 + childComplexity;
			};

			measureComplexity(basicSchema, 'query { user(id: "1") { id name } }', { estimators: [est] });

			// id: childComplexity=0
			// name: childComplexity=0
			// user: childComplexity=2 (id=1 + name=1)
			expect(received).toContain(0);
			expect(received).toContain(2);
		});

		it("should pass correct args to estimators", () => {
			const captured: Record<string, unknown>[] = [];
			const est = ({
				args,
				childComplexity,
			}: {
				args: Record<string, unknown>;
				childComplexity: number;
			}) => {
				captured.push(args);
				return 1 + childComplexity;
			};

			measureComplexity(basicSchema, "query { users(limit: 5) { id } }", { estimators: [est] });

			const argsWithLimit = captured.find((a) => typeof a.limit === "number");
			expect(argsWithLimit).toEqual({ limit: 5 });
		});

		it("should coerce variables into arguments", () => {
			const captured: Record<string, unknown>[] = [];
			const est = ({
				args,
				childComplexity,
			}: {
				args: Record<string, unknown>;
				childComplexity: number;
			}) => {
				captured.push(args);
				return 1 + childComplexity;
			};

			measureComplexity(basicSchema, "query($l: Int!) { users(limit: $l) { id } }", {
				estimators: [est],
				variables: { l: 42 },
			});

			const argsWithLimit = captured.find((a) => typeof a.limit === "number");
			expect(argsWithLimit).toEqual({ limit: 42 });
		});
	});

	// -------------------------------------------------------------------
	// @skip / @include
	// -------------------------------------------------------------------
	describe("@skip and @include", () => {
		it("should exclude fields with @skip(if: true)", () => {
			const { complexity } = measureComplexity(
				basicSchema,
				'query { user(id: "1") { id name @skip(if: true) } }',
			);
			expect(complexity).toBe(2);
		});

		it("should include fields with @include(if: true)", () => {
			const { complexity } = measureComplexity(
				basicSchema,
				'query { user(id: "1") { id name @include(if: true) } }',
			);
			expect(complexity).toBe(3);
		});

		it("should skip fragment spreads with @skip(if: true)", () => {
			const { complexity } = measureComplexity(
				basicSchema,
				`fragment F on User { id name }
				query { user(id: "1") { ...F @skip(if: true) } }`,
			);
			// user(1) only — fragment skipped
			expect(complexity).toBe(1);
		});

		it("should skip inline fragments with @include(if: false)", () => {
			const { complexity } = measureComplexity(
				basicSchema,
				`query {
					user(id: "1") {
						... on User @include(if: false) { id name }
					}
				}`,
			);
			// user(1) only
			expect(complexity).toBe(1);
		});
	});

	// -------------------------------------------------------------------
	// Directive-based estimation (@complexity)
	// -------------------------------------------------------------------
	describe("@complexity directive", () => {
		const estimators = [fieldExtensionsEstimator(), simpleEstimator()];

		it("should use static value from directive", () => {
			const { complexity } = measureComplexity(directiveSchema, "query { posts { id title } }", {
				estimators,
			});
			// posts(@complexity value=10) + childComplexity(id=1, title=@complexity value=5) = 10 + 1 + 5 = 16
			expect(complexity).toBe(16);
		});

		it("should multiply by a single multiplier", () => {
			const { complexity } = measureComplexity(
				directiveSchema,
				"query { users(limit: 10) { id name } }",
				{ estimators },
			);
			// child = id(1) + name(1) = 2
			// users = value(2) + limit(10) * child(2) = 2 + 20 = 22
			expect(complexity).toBe(22);
		});

		it("should multiply by multiple multipliers", () => {
			const { complexity } = measureComplexity(
				multiMultiplierSchema,
				"query { items(limit: 10, take: 5) { id } }",
				{ estimators },
			);
			// child = id(1)
			// items = value(5) + (limit*take)(50) * child(1) = 5 + 50 = 55
			expect(complexity).toBe(55);
		});

		it("should ignore missing multiplier arguments", () => {
			const { complexity } = measureComplexity(directiveSchema, "query { users { id } }", {
				estimators,
			});
			// child = id(1)
			// users = value(2) + multiplier(1) * child(1) = 2 + 1 = 3
			expect(complexity).toBe(3);
		});

		it("should fall back to next estimator when no directive", () => {
			const { complexity } = measureComplexity(directiveSchema, "query { simple }", {
				estimators: [fieldExtensionsEstimator(), simpleEstimator({ defaultComplexity: 5 })],
			});
			expect(complexity).toBe(5);
		});
	});

	// -------------------------------------------------------------------
	// Estimator edge cases
	// -------------------------------------------------------------------
	describe("estimator edge cases", () => {
		it("should clamp negative estimator returns to 0", () => {
			const { complexity } = measureComplexity(basicSchema, 'query { user(id: "1") { id } }', {
				estimators: [() => -100],
			});
			// Both id and user return -100, clamped to 0
			expect(complexity).toBe(0);
		});

		it("should not allow negative values to offset other field costs", () => {
			const { complexity } = measureComplexity(basicSchema, 'query { user(id: "1") { id name } }', {
				estimators: [
					({ field, childComplexity }) => {
						if (field.name === "id") return -50;
						return 5 + childComplexity;
					},
				],
			});
			// id: clamped to 0, name: 5+0=5, user: 5+5(children)=10
			expect(complexity).toBe(10);
		});

		it("should accept 0 as a valid estimator return", () => {
			const { complexity } = measureComplexity(basicSchema, 'query { user(id: "1") { id } }', {
				estimators: [() => 0],
			});
			expect(complexity).toBe(0);
		});

		it("should skip NaN and fall through to next estimator", () => {
			const { complexity } = measureComplexity(basicSchema, "query { users { id } }", {
				estimators: [() => Number.NaN, simpleEstimator({ defaultComplexity: 3 })],
			});
			// NaN is not finite, so falls through to simpleEstimator
			// users: 3 + id(3) = 6
			expect(complexity).toBe(6);
		});

		it("should skip Infinity and fall through to next estimator", () => {
			const { complexity } = measureComplexity(basicSchema, "query { users { id } }", {
				estimators: [() => Number.POSITIVE_INFINITY, simpleEstimator({ defaultComplexity: 2 })],
			});
			// Infinity is not finite, so falls through to simpleEstimator
			// users: 2 + id(2) = 4
			expect(complexity).toBe(4);
		});

		it("should use default cost when all estimators return non-finite values", () => {
			const { complexity } = measureComplexity(basicSchema, "query { users { id } }", {
				estimators: [() => Number.NaN, () => Number.POSITIVE_INFINITY],
			});
			// Falls back to defaultCost(1) + childComplexity
			// users: 1 + id(1) = 2
			expect(complexity).toBe(2);
		});
	});

	// -------------------------------------------------------------------
	// Abstract types
	// -------------------------------------------------------------------
	describe("abstract types", () => {
		it("should handle interfaces with inline fragments", () => {
			const { complexity } = measureComplexity(
				abstractSchema,
				`query {
					search(term: "test") {
						relevance
						... on Post { id title }
						... on User { name }
					}
				}`,
			);
			// search(1) + relevance(1) + id(1) + title(1) + name(1) = 5
			expect(complexity).toBe(5);
		});

		it("should handle unions with inline fragments", () => {
			const { complexity } = measureComplexity(
				abstractSchema,
				`query {
					media {
						... on Post { id title }
						... on User { id name }
					}
				}`,
			);
			// media(1) + id(1) + title(1) + id(1) + name(1) = 5
			expect(complexity).toBe(5);
		});
	});
});
