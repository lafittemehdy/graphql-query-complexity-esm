import { buildSchema, GraphQLError, parse, validate } from "graphql";
import { describe, expect, it, vi } from "vitest";
import { complexityLimit } from "../complexity-rule.js";
import { ERROR_CODES } from "../constants.js";
import { simpleEstimator } from "../estimators.js";
import type { ComplexityCallback } from "../types.js";
import { abstractSchema, basicSchema } from "./fixtures.js";

describe("complexityLimit", () => {
	// -------------------------------------------------------------------
	// Input validation
	// -------------------------------------------------------------------
	describe("input validation", () => {
		it("should throw on non-positive maxComplexity", () => {
			expect(() => complexityLimit(0)).toThrow(RangeError);
			expect(() => complexityLimit(-1)).toThrow(RangeError);
			expect(() => complexityLimit(-100)).toThrow(RangeError);
		});

		it("should throw on non-integer maxComplexity", () => {
			expect(() => complexityLimit(1.5)).toThrow(RangeError);
			expect(() => complexityLimit(0.1)).toThrow(RangeError);
		});

		it("should throw on NaN / Infinity maxComplexity", () => {
			expect(() => complexityLimit(Number.NaN)).toThrow(RangeError);
			expect(() => complexityLimit(Number.POSITIVE_INFINITY)).toThrow(RangeError);
			expect(() => complexityLimit(Number.NEGATIVE_INFINITY)).toThrow(RangeError);
		});

		it("should throw when options is not an object", () => {
			expect(() => complexityLimit(100, "bad" as unknown as Record<string, unknown>)).toThrow(
				TypeError,
			);
			expect(() => complexityLimit(100, 42 as unknown as Record<string, unknown>)).toThrow(
				TypeError,
			);
			expect(() => complexityLimit(100, [] as unknown as Record<string, unknown>)).toThrow(
				TypeError,
			);
		});

		it("should throw when options is not a plain object", () => {
			class OptionsLike {
				public readonly defaultComplexity = 2;
			}

			expect(() =>
				complexityLimit(100, new OptionsLike() as unknown as Record<string, unknown>),
			).toThrow(TypeError);
		});

		it("should throw when variables is not a plain object", () => {
			expect(() =>
				complexityLimit(100, {
					variables: [] as unknown as Record<string, unknown>,
				}),
			).toThrow(TypeError);
			expect(() =>
				complexityLimit(100, {
					variables: null as unknown as Record<string, unknown>,
				}),
			).toThrow(TypeError);
			expect(() =>
				complexityLimit(100, {
					variables: 42 as unknown as Record<string, unknown>,
				}),
			).toThrow(TypeError);

			class VariablesLike {}
			expect(() =>
				complexityLimit(100, {
					variables: new VariablesLike() as unknown as Record<string, unknown>,
				}),
			).toThrow(TypeError);
		});

		it("should throw when callback is not a function", () => {
			expect(() => complexityLimit(100, {}, "bad" as unknown as ComplexityCallback)).toThrow(
				TypeError,
			);
		});

		it("should throw when callback is passed twice", () => {
			expect(() =>
				complexityLimit(
					100,
					() => undefined,
					() => undefined,
				),
			).toThrow(TypeError);
		});

		it("should throw on invalid defaultComplexity", () => {
			expect(() => complexityLimit(100, { defaultComplexity: -1 })).toThrow(RangeError);
			expect(() => complexityLimit(100, { defaultComplexity: 1.5 })).toThrow(RangeError);
		});

		it("should throw on invalid maxNodes", () => {
			expect(() => complexityLimit(100, { maxNodes: 0 })).toThrow(RangeError);
			expect(() => complexityLimit(100, { maxNodes: -1 })).toThrow(RangeError);
			expect(() => complexityLimit(100, { maxNodes: 1.5 })).toThrow(RangeError);
		});

		it("should throw when estimators is empty or non-array", () => {
			expect(() => complexityLimit(100, { estimators: [] })).toThrow(TypeError);
			expect(() =>
				complexityLimit(100, {
					estimators: "bad" as unknown as [],
				}),
			).toThrow(TypeError);
		});

		it("should throw when an estimator is not a function", () => {
			expect(() =>
				complexityLimit(100, {
					estimators: [42 as unknown as () => undefined],
				}),
			).toThrow(TypeError);
		});
	});

	// -------------------------------------------------------------------
	// Overloaded call signatures
	// -------------------------------------------------------------------
	describe("overloaded signatures", () => {
		it("should accept (maxComplexity)", () => {
			const rule = complexityLimit(100);
			expect(typeof rule).toBe("function");
		});

		it("should accept (maxComplexity, options)", () => {
			const rule = complexityLimit(100, {
				estimators: [simpleEstimator()],
			});
			expect(typeof rule).toBe("function");
		});

		it("should accept (maxComplexity, callback)", () => {
			const cb = vi.fn();
			const rule = complexityLimit(100, cb);
			expect(typeof rule).toBe("function");
		});

		it("should accept (maxComplexity, options, callback)", () => {
			const cb = vi.fn();
			const rule = complexityLimit(100, {}, cb);
			expect(typeof rule).toBe("function");
		});
	});

	// -------------------------------------------------------------------
	// Basic complexity calculation
	// -------------------------------------------------------------------
	describe("basic complexity", () => {
		it("should calculate simple query complexity", () => {
			const cb = vi.fn();
			const rule = complexityLimit(100, {}, cb);
			const doc = parse('query Q { user(id: "1") { id name } }');
			const errors = validate(basicSchema, doc, [rule]);

			expect(errors).toHaveLength(0);
			expect(cb).toHaveBeenCalledOnce();
			// user(1) + id(1) + name(1) = 3
			expect(cb.mock.calls[0]?.[0]).toEqual({ Q: 3 });
		});

		it("should calculate nested query complexity", () => {
			const cb = vi.fn();
			const rule = complexityLimit(100, {}, cb);
			const doc = parse(`
				query { user(id: "1") { id posts { id title } } }
			`);
			const errors = validate(basicSchema, doc, [rule]);

			expect(errors).toHaveLength(0);
			// user(1) + id(1) + posts(1) + posts.id(1) + posts.title(1) = 5
			expect(cb.mock.calls[0]?.[0]).toEqual({ "[anonymous]": 5 });
		});

		it("should reject queries exceeding maxComplexity", () => {
			const rule = complexityLimit(3);
			const doc = parse(`
				query { user(id: "1") { id name posts { id } } }
			`);
			const errors = validate(basicSchema, doc, [rule]);

			expect(errors).toHaveLength(1);
			expect(errors[0]?.message).toContain("exceeds maximum complexity of 3");
			expect(errors[0]?.extensions?.code).toBe(ERROR_CODES.QUERY_TOO_COMPLEX);
		});

		it("should pass queries within the limit", () => {
			const rule = complexityLimit(10);
			const doc = parse('query { user(id: "1") { id name } }');
			const errors = validate(basicSchema, doc, [rule]);

			expect(errors).toHaveLength(0);
		});

		it("should allow defaultComplexity of 0", () => {
			const cb = vi.fn();
			const rule = complexityLimit(100, { defaultComplexity: 0 }, cb);
			const doc = parse('query { user(id: "1") { id name } }');
			const errors = validate(basicSchema, doc, [rule]);

			expect(errors).toHaveLength(0);
			expect(cb).toHaveBeenCalledOnce();
			// With defaultComplexity=0: user(0+0+0) + id(0) + name(0) = 0
			expect(cb.mock.calls[0]?.[0]).toEqual({ "[anonymous]": 0 });
		});
	});

	// -------------------------------------------------------------------
	// Callback behavior
	// -------------------------------------------------------------------
	describe("callback", () => {
		it("should not invoke callback when query exceeds limit", () => {
			const cb = vi.fn();
			const rule = complexityLimit(1, {}, cb);
			const doc = parse('query { user(id: "1") { id name } }');
			validate(basicSchema, doc, [rule]);

			expect(cb).not.toHaveBeenCalled();
		});

		it("should use null-prototype object for callback payload", () => {
			const cb = vi.fn();
			const rule = complexityLimit(100, {}, cb);
			const doc = parse("query { users { id } }");
			validate(basicSchema, doc, [rule]);

			expect(cb).toHaveBeenCalledOnce();
			const payload = cb.mock.calls[0]?.[0];
			expect(Object.getPrototypeOf(payload)).toBeNull();
		});

		it("should generate deterministic names for anonymous operations", () => {
			const cb = vi.fn();
			const rule = complexityLimit(1000, {}, cb);
			const doc = parse(`
				query { users { id } }
				query Named { users { id } }
			`);
			validate(basicSchema, doc, [rule]);

			expect(cb).toHaveBeenCalledOnce();
			const payload = cb.mock.calls[0]?.[0];
			expect(payload).toHaveProperty("[anonymous]");
			expect(payload).toHaveProperty("Named");
		});

		it("should report per-operation complexities", () => {
			const cb = vi.fn();
			const rule = complexityLimit(1000, {}, cb);
			const doc = parse(`
				query A { users { id } }
				query B { users { id name } }
			`);
			validate(basicSchema, doc, [rule]);

			expect(cb).toHaveBeenCalledOnce();
			const payload = cb.mock.calls[0]?.[0] as Record<string, number>;
			// A: users(1) + id(1) = 2
			expect(payload.A).toBe(2);
			// B: users(1) + id(1) + name(1) = 3
			expect(payload.B).toBe(3);
		});

		it("should stop evaluating additional operations after first violation", () => {
			const est = vi.fn(({ childComplexity }: { childComplexity: number }) => 1 + childComplexity);
			const rule = complexityLimit(1, { estimators: [est] });
			const doc = parse(`
				query One { user(id: "1") { id name posts { id } } }
				query Two { user(id: "1") { id name posts { id } } }
			`);

			const errors = validate(basicSchema, doc, [rule]);

			expect(errors).toHaveLength(1);
			// Only the first operation should be evaluated: user, id, name, posts, id
			expect(est).toHaveBeenCalledTimes(5);
		});

		it("should not invoke callback when node limit is exceeded", () => {
			const cb = vi.fn();
			const rule = complexityLimit(10000, { maxNodes: 2 }, cb);
			const doc = parse('query { user(id: "1") { id name } }');
			validate(basicSchema, doc, [rule]);

			expect(cb).not.toHaveBeenCalled();
		});

		it("should not invoke callback when estimator throws", () => {
			const cb = vi.fn();
			const rule = complexityLimit(
				100,
				{
					estimators: [
						() => {
							throw new Error("estimator failure");
						},
					],
				},
				cb,
			);
			const doc = parse('query { user(id: "1") { id } }');
			validate(basicSchema, doc, [rule]);

			expect(cb).not.toHaveBeenCalled();
		});
	});

	// -------------------------------------------------------------------
	// Node limit
	// -------------------------------------------------------------------
	describe("node limit", () => {
		it("should reject queries exceeding custom maxNodes", () => {
			const rule = complexityLimit(10000, { maxNodes: 3 });
			const doc = parse(`
				query { user(id: "1") { id name posts { id } } }
			`);
			const errors = validate(basicSchema, doc, [rule]);

			expect(errors).toHaveLength(1);
			expect(errors[0]?.message).toContain("node limit");
			expect(errors[0]?.extensions?.code).toBe(ERROR_CODES.NODE_LIMIT_EXCEEDED);
		});

		it("should reject wide queries exceeding default node limit", () => {
			// Build a query with > 10 000 aliased fields
			let fields = "";
			for (let i = 0; i < 5001; i++) {
				fields += ` a${i}: id`;
			}
			for (let i = 0; i < 5000; i++) {
				fields += ` b${i}: name`;
			}
			const rule = complexityLimit(Number.MAX_SAFE_INTEGER);
			const doc = parse(`query { user(id: "1") { ${fields} } }`);
			const errors = validate(basicSchema, doc, [rule]);

			expect(errors).toHaveLength(1);
			expect(errors[0]?.extensions?.code).toBe(ERROR_CODES.NODE_LIMIT_EXCEEDED);
		});

		it("should reject queries when maxNodes is 1", () => {
			const rule = complexityLimit(10000, { maxNodes: 1 });
			const doc = parse("query { users { id } }");
			const errors = validate(basicSchema, doc, [rule]);

			// "users" is node 1 (allowed), "id" is node 2 (exceeds limit of 1)
			expect(errors).toHaveLength(1);
			expect(errors[0]?.extensions?.code).toBe(ERROR_CODES.NODE_LIMIT_EXCEEDED);
		});
	});

	// -------------------------------------------------------------------
	// Custom estimators
	// -------------------------------------------------------------------
	describe("custom estimators", () => {
		it("should convert estimator throws into GraphQL errors", () => {
			const rule = complexityLimit(100, {
				estimators: [
					() => {
						throw new Error("boom");
					},
				],
			});
			const doc = parse('query { user(id: "1") { id } }');

			const errors = validate(basicSchema, doc, [rule]);

			expect(errors).toHaveLength(1);
			expect(errors[0]?.extensions?.code).toBe(ERROR_CODES.ESTIMATOR_ERROR);
			expect(errors[0]?.message).toContain("boom");
		});

		it("should wrap raw GraphQLError thrown by estimator with ESTIMATOR_ERROR code", () => {
			const rule = complexityLimit(100, {
				estimators: [
					() => {
						throw new GraphQLError("raw graphql error");
					},
				],
			});
			const doc = parse('query { user(id: "1") { id } }');
			const errors = validate(basicSchema, doc, [rule]);

			expect(errors).toHaveLength(1);
			expect(errors[0]?.extensions?.code).toBe(ERROR_CODES.ESTIMATOR_ERROR);
			expect(errors[0]?.message).toContain("raw graphql error");
		});

		it("should handle non-Error thrown values from estimators", () => {
			const stringRule = complexityLimit(100, {
				estimators: [
					() => {
						throw "string boom";
					},
				],
			});
			const stringErrors = validate(basicSchema, parse('query { user(id: "1") { id } }'), [
				stringRule,
			]);
			expect(stringErrors[0]?.extensions?.code).toBe(ERROR_CODES.ESTIMATOR_ERROR);
			expect(stringErrors[0]?.message).toContain("string boom");

			const bigintRule = complexityLimit(100, {
				estimators: [
					() => {
						throw 1n;
					},
				],
			});
			const bigintErrors = validate(basicSchema, parse('query { user(id: "1") { id } }'), [
				bigintRule,
			]);
			expect(bigintErrors[0]?.extensions?.code).toBe(ERROR_CODES.ESTIMATOR_ERROR);
			expect(bigintErrors[0]?.message).toContain("1");
		});

		it("should use a custom estimator for pagination", () => {
			const cb = vi.fn();
			const rule = complexityLimit(
				1000,
				{
					estimators: [
						({ args, childComplexity }) => {
							if (typeof args.limit === "number") {
								return args.limit * (1 + childComplexity);
							}
							return undefined;
						},
						simpleEstimator(),
					],
				},
				cb,
			);
			const doc = parse("query { users(limit: 10) { id name } }");
			validate(basicSchema, doc, [rule]);

			expect(cb).toHaveBeenCalledOnce();
			// users: 10 * (1 + id(1) + name(1)) = 10 * 3 = 30
			expect(cb.mock.calls[0]?.[0]).toEqual({ "[anonymous]": 30 });
		});

		it("should fall through when estimator returns undefined", () => {
			const est1 = vi.fn(() => undefined);
			const est2 = vi.fn(({ childComplexity }: { childComplexity: number }) => 2 + childComplexity);

			const cb = vi.fn();
			const rule = complexityLimit(100, { estimators: [est1, est2] }, cb);
			const doc = parse('query { user(id: "1") { id } }');
			validate(basicSchema, doc, [rule]);

			expect(est1).toHaveBeenCalled();
			expect(est2).toHaveBeenCalled();
			// id: 2+0=2, user: 2+2=4
			expect(cb.mock.calls[0]?.[0]).toEqual({ "[anonymous]": 4 });
		});

		it("should use default when all estimators return undefined", () => {
			const cb = vi.fn();
			const rule = complexityLimit(100, { estimators: [() => undefined, () => undefined] }, cb);
			const doc = parse('query { user(id: "1") { id name } }');
			validate(basicSchema, doc, [rule]);

			expect(cb).toHaveBeenCalledOnce();
			// Falls back to 1 + childComplexity for each field
			// user(1 + 2) = 3, id(1), name(1) → 3
			expect(cb.mock.calls[0]?.[0]).toEqual({ "[anonymous]": 3 });
		});
	});

	// -------------------------------------------------------------------
	// @skip / @include support
	// -------------------------------------------------------------------
	describe("@skip and @include", () => {
		it("should skip fields with @skip(if: true)", () => {
			const cb = vi.fn();
			const rule = complexityLimit(100, {}, cb);
			const doc = parse(`
				query {
					user(id: "1") {
						id
						name @skip(if: true)
						posts { id }
					}
				}
			`);
			validate(basicSchema, doc, [rule]);

			// user(1) + id(1) + posts(1) + posts.id(1) = 4
			expect(cb.mock.calls[0]?.[0]).toEqual({ "[anonymous]": 4 });
		});

		it("should include fields with @skip(if: false)", () => {
			const cb = vi.fn();
			const rule = complexityLimit(100, {}, cb);
			const doc = parse(`
				query { user(id: "1") { id name @skip(if: false) } }
			`);
			validate(basicSchema, doc, [rule]);

			expect(cb.mock.calls[0]?.[0]).toEqual({ "[anonymous]": 3 });
		});

		it("should exclude fields with @include(if: false)", () => {
			const cb = vi.fn();
			const rule = complexityLimit(100, {}, cb);
			const doc = parse(`
				query { user(id: "1") { id name @include(if: false) } }
			`);
			validate(basicSchema, doc, [rule]);

			expect(cb.mock.calls[0]?.[0]).toEqual({ "[anonymous]": 2 });
		});

		it("should handle directives with variables", () => {
			const cbWith = vi.fn();
			const ruleWith = complexityLimit(100, { variables: { show: true } }, cbWith);
			const doc = parse(`
				query ($show: Boolean!) {
					user(id: "1") { id name @include(if: $show) }
				}
			`);
			validate(basicSchema, doc, [ruleWith]);
			expect(cbWith.mock.calls[0]?.[0]).toEqual({ "[anonymous]": 3 });

			const cbWithout = vi.fn();
			const ruleWithout = complexityLimit(100, { variables: { show: false } }, cbWithout);
			validate(basicSchema, doc, [ruleWithout]);
			expect(cbWithout.mock.calls[0]?.[0]).toEqual({ "[anonymous]": 2 });
		});
	});

	// -------------------------------------------------------------------
	// Fragments
	// -------------------------------------------------------------------
	describe("fragment handling", () => {
		it("should handle named fragments", () => {
			const cb = vi.fn();
			const rule = complexityLimit(100, {}, cb);
			const doc = parse(`
				fragment UserFields on User { id name }
				query { user(id: "1") { ...UserFields posts { id } } }
			`);
			validate(basicSchema, doc, [rule]);

			// user(1) + id(1) + name(1) + posts(1) + posts.id(1) = 5
			expect(cb.mock.calls[0]?.[0]).toEqual({ "[anonymous]": 5 });
		});

		it("should handle inline fragments", () => {
			const cb = vi.fn();
			const rule = complexityLimit(100, {}, cb);
			const doc = parse(`
				query { user(id: "1") { ... on User { id name } } }
			`);
			validate(basicSchema, doc, [rule]);

			expect(cb.mock.calls[0]?.[0]).toEqual({ "[anonymous]": 3 });
		});

		it("should handle nested fragments", () => {
			const cb = vi.fn();
			const rule = complexityLimit(100, {}, cb);
			const doc = parse(`
				fragment PostFields on Post { id title }
				fragment UserFull on User { id name posts { ...PostFields } }
				query { user(id: "1") { ...UserFull } }
			`);
			validate(basicSchema, doc, [rule]);

			// user(1) + id(1) + name(1) + posts(1) + id(1) + title(1) = 6
			expect(cb.mock.calls[0]?.[0]).toEqual({ "[anonymous]": 6 });
		});

		it("should allow the same fragment in parallel branches", () => {
			const cb = vi.fn();
			const rule = complexityLimit(1000, {}, cb);
			const doc = parse(`
				fragment Basic on User { id name }
				query {
					user(id: "1") {
						...Basic
						posts {
							author { ...Basic }
						}
					}
				}
			`);
			validate(basicSchema, doc, [rule]);

			// user(1) + id(1) + name(1) + posts(1) + author(1) + id(1) + name(1) = 7
			expect(cb.mock.calls[0]?.[0]).toEqual({ "[anonymous]": 7 });
		});

		it("should handle circular fragments without infinite loop", () => {
			const cb = vi.fn();
			const rule = complexityLimit(1000, {}, cb);
			const doc = parse(`
				fragment UserFields on User {
					id
					friends { ...UserFields }
				}
				query { user(id: "1") { ...UserFields } }
			`);

			// Should not hang
			const errors = validate(basicSchema, doc, [rule]);
			expect(errors).toHaveLength(0);
			expect(cb).toHaveBeenCalledOnce();
			const cost = cb.mock.calls[0]?.[0]?.["[anonymous]"];
			expect(cost).toBeGreaterThan(0);
		});
	});

	// -------------------------------------------------------------------
	// Abstract types
	// -------------------------------------------------------------------
	describe("abstract types", () => {
		it("should calculate complexity for interfaces and unions", () => {
			const cb = vi.fn();
			const rule = complexityLimit(100, {}, cb);
			const doc = parse(`
				query {
					search(term: "graphql") {
						relevance
						... on Post { id title }
						... on User { name }
					}
					media {
						... on Post { id }
					}
				}
			`);
			validate(abstractSchema, doc, [rule]);

			// search(1) + relevance(1) + id(1) + title(1) + name(1) = 5
			// media(1) + id(1) = 2
			// total = 7
			expect(cb.mock.calls[0]?.[0]).toEqual({ "[anonymous]": 7 });
		});
	});

	// -------------------------------------------------------------------
	// Mutation support
	// -------------------------------------------------------------------
	describe("mutations", () => {
		it("should calculate mutation complexity", () => {
			const cb = vi.fn();
			const rule = complexityLimit(100, {}, cb);
			const doc = parse(`
				mutation {
					createPost(title: "Hi", content: "World") {
						id
						title
					}
				}
			`);
			validate(basicSchema, doc, [rule]);

			// createPost(1) + id(1) + title(1) = 3
			expect(cb.mock.calls[0]?.[0]).toEqual({ "[anonymous]": 3 });
		});
	});

	// -------------------------------------------------------------------
	// onCoercionError callback
	// -------------------------------------------------------------------
	describe("onCoercionError", () => {
		it("should invoke onCoercionError when argument coercion fails", () => {
			const onCoercionError = vi.fn();
			const cb = vi.fn();
			const rule = complexityLimit(100, { onCoercionError }, cb);

			// user(id: ID!) requires `id`; omitting it causes getArgumentValues
			// to throw, triggering coerceArguments catch → onCoercionError.
			const doc = parse("query { user { id } }");
			validate(basicSchema, doc, [rule]);

			expect(onCoercionError).toHaveBeenCalledOnce();
			expect(onCoercionError).toHaveBeenCalledWith(
				expect.objectContaining({
					fieldName: "user",
					parentType: "Query",
				}),
			);
			expect(onCoercionError.mock.calls[0][0].error).toBeDefined();
		});

		it("should throw when onCoercionError is not a function", () => {
			expect(() =>
				complexityLimit(100, {
					onCoercionError: "bad" as unknown as () => void,
				}),
			).toThrow(TypeError);
		});
	});

	// -------------------------------------------------------------------
	// Callback exception safety
	// -------------------------------------------------------------------
	describe("callback exception safety", () => {
		it("should not crash when the callback throws", () => {
			const rule = complexityLimit(100, {}, () => {
				throw new Error("callback boom");
			});
			const doc = parse('query { user(id: "1") { id } }');
			const errors = validate(basicSchema, doc, [rule]);

			expect(errors).toHaveLength(0);
		});

		it("should not crash when the callback throws a non-Error value", () => {
			const rule = complexityLimit(100, {}, () => {
				throw "string boom";
			});
			const doc = parse('query { user(id: "1") { id } }');
			const errors = validate(basicSchema, doc, [rule]);

			expect(errors).toHaveLength(0);
		});
	});

	// -------------------------------------------------------------------
	// Multi-operation mixed violations
	// -------------------------------------------------------------------
	describe("multi-operation mixed violations", () => {
		it("should report error from the first violating operation", () => {
			const rule = complexityLimit(2);
			const doc = parse(`
				query Small { users { id } }
				query Big { users { id name posts { id title } } }
			`);
			const errors = validate(basicSchema, doc, [rule]);

			// Small: users(1) + id(1) = 2 (within limit)
			// Big: users(1) + id(1) + name(1) + posts(1) + id(1) + title(1) = 6 (exceeds 2)
			expect(errors).toHaveLength(1);
			expect(errors[0]?.message).toContain("exceeds maximum complexity of 2");
		});
	});

	// -------------------------------------------------------------------
	// Additional runtime edge-cases
	// -------------------------------------------------------------------
	describe("runtime edge-cases", () => {
		it("should continue when argument coercion fails", () => {
			const capturedArgs: Record<string, unknown>[] = [];
			const rule = complexityLimit(
				100,
				{
					estimators: [
						({ args, childComplexity }) => {
							capturedArgs.push(args);
							return 1 + childComplexity;
						},
					],
				},
				vi.fn(),
			);

			const errors = validate(basicSchema, parse("query { user { id } }"), [rule]);

			expect(errors).toHaveLength(0);
			const argsWithLimit = capturedArgs.find((args) => "id" in args);
			expect(argsWithLimit).toBeUndefined();
		});

		it("should continue when directive variable coercion fails", () => {
			const cb = vi.fn();
			const rule = complexityLimit(100, {}, cb);
			const doc = parse(`
				query ($skip: Boolean!) {
					user(id: "1") {
						id
						name @skip(if: $skip)
					}
				}
			`);

			const errors = validate(basicSchema, doc, [rule]);
			expect(errors).toHaveLength(0);
			expect(cb).toHaveBeenCalledOnce();
			// Missing runtime variable means @skip cannot be resolved; include field.
			expect(cb.mock.calls[0]?.[0]).toEqual({ "[anonymous]": 3 });
		});

		it("should handle subscription operations", () => {
			const schema = buildSchema(`
				type Query {
					_health: String
				}
				type Subscription {
					newMessage: Message
				}
				type Message {
					id: ID!
					body: String!
				}
			`);
			const cb = vi.fn();
			const rule = complexityLimit(100, {}, cb);
			const doc = parse("subscription { newMessage { id body } }");

			const errors = validate(schema, doc, [rule]);

			expect(errors).toHaveLength(0);
			expect(cb).toHaveBeenCalledOnce();
			expect(cb.mock.calls[0]?.[0]).toEqual({ "[anonymous]": 3 });
		});
	});
});
