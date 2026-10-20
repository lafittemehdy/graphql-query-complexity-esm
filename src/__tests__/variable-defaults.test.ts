import { buildSchema, parse, validate } from "graphql";
import { describe, expect, it } from "vitest";
import { complexityLimit } from "../complexity-rule.js";
import { simpleEstimator } from "../estimators.js";
import { getComplexity } from "../get-complexity.js";

const schema = buildSchema("type Query { users(limit: Int): [User] } type User { name: String }");
const estimators = [
	({ args, childComplexity }: Parameters<ReturnType<typeof simpleEstimator>>[0]) =>
		typeof args.limit === "number" ? args.limit * (1 + childComplexity) : undefined,
	simpleEstimator(),
];

describe("operation variable defaults", () => {
	it("uses default multipliers instead of undercounting omitted variables", () => {
		const query = "query($limit: Int = 100) { users(limit: $limit) { name } }";
		expect(getComplexity({ schema, query, estimators })).toBe(200);
		expect(
			validate(schema, parse(query), [complexityLimit(50, { estimators })])[0]?.extensions.code,
		).toBe("QUERY_TOO_COMPLEX");
		expect(getComplexity({ schema, query, estimators, variables: { limit: 2 } })).toBe(4);
	});
	it("uses default directive variables", () => {
		expect(
			getComplexity({
				schema,
				query: "query($show: Boolean = false) { users @include(if: $show) { name } }",
				estimators,
			}),
		).toBe(0);
	});
});
