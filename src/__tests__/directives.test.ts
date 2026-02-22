import { buildSchema, parse } from "graphql";
import { describe, expect, it } from "vitest";
import { complexityDirectiveTypeDefs, shouldSkipNode } from "../directives.js";

/** Extract the first selection node from a parsed query. */
function parseFirstSelection(query: string) {
	const doc = parse(query);
	const op = doc.definitions[0];
	if (!op || op.kind !== "OperationDefinition") throw new Error("Expected operation");
	const sel = op.selectionSet.selections[0];
	if (!sel) throw new Error("Expected selection");
	return sel;
}

describe("directives", () => {
	// -------------------------------------------------------------------
	// complexityDirectiveTypeDefs
	// -------------------------------------------------------------------
	describe("complexityDirectiveTypeDefs", () => {
		it("should export a valid directive SDL string", () => {
			expect(typeof complexityDirectiveTypeDefs).toBe("string");
			expect(complexityDirectiveTypeDefs).toContain("directive @complexity");
			expect(complexityDirectiveTypeDefs).toContain("value: Int!");
			expect(complexityDirectiveTypeDefs).toContain("multipliers: [String!]");
			expect(complexityDirectiveTypeDefs).toContain("FIELD_DEFINITION");
		});

		it("should be usable in a schema built with buildSchema", () => {
			const schema = buildSchema(`
				${complexityDirectiveTypeDefs}
				type Query {
					users(limit: Int): [User!]! @complexity(value: 2, multipliers: ["limit"])
				}
				type User { id: ID! }
			`);
			expect(schema).toBeTruthy();
		});
	});

	// -------------------------------------------------------------------
	// shouldSkipNode
	// -------------------------------------------------------------------
	describe("shouldSkipNode", () => {
		it("should return false for nodes without directives", () => {
			const node = parseFirstSelection("{ name }");
			expect(shouldSkipNode(node, {})).toBe(false);
		});

		it("should return true when @skip(if: true)", () => {
			const node = parseFirstSelection("{ name @skip(if: true) }");
			expect(shouldSkipNode(node, {})).toBe(true);
		});

		it("should return false when @skip(if: false)", () => {
			const node = parseFirstSelection("{ name @skip(if: false) }");
			expect(shouldSkipNode(node, {})).toBe(false);
		});

		it("should return true when @include(if: false)", () => {
			const node = parseFirstSelection("{ name @include(if: false) }");
			expect(shouldSkipNode(node, {})).toBe(true);
		});

		it("should return false when @include(if: true)", () => {
			const node = parseFirstSelection("{ name @include(if: true) }");
			expect(shouldSkipNode(node, {})).toBe(false);
		});

		it("should resolve @skip variable references", () => {
			const node = parseFirstSelection("query ($s: Boolean!) { name @skip(if: $s) }");
			expect(shouldSkipNode(node, { s: true })).toBe(true);
			expect(shouldSkipNode(node, { s: false })).toBe(false);
		});

		it("should resolve @include variable references", () => {
			const node = parseFirstSelection("query ($i: Boolean!) { name @include(if: $i) }");
			expect(shouldSkipNode(node, { i: true })).toBe(false);
			expect(shouldSkipNode(node, { i: false })).toBe(true);
		});

		it("should not throw when directive variable coercion fails", () => {
			const node = parseFirstSelection("query ($s: Boolean!) { name @skip(if: $s) }");
			expect(() => shouldSkipNode(node, {})).not.toThrow();
			expect(shouldSkipNode(node, {})).toBe(false);
		});

		it("should prioritize @skip over @include when both are true", () => {
			const node = parseFirstSelection("{ name @skip(if: true) @include(if: true) }");
			expect(shouldSkipNode(node, {})).toBe(true);
		});

		it("should not skip when @skip(if: false) and @include(if: true)", () => {
			const node = parseFirstSelection("{ name @skip(if: false) @include(if: true) }");
			expect(shouldSkipNode(node, {})).toBe(false);
		});

		it("should return false for nodes with empty directives array", () => {
			expect(shouldSkipNode({ directives: [] }, {})).toBe(false);
		});

		it("should return false for nodes with undefined directives", () => {
			expect(shouldSkipNode({}, {})).toBe(false);
		});
	});
});
