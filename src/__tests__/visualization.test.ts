import { describe, expect, it } from "vitest";
import { analyzeQuery } from "../../examples/visualization/src/lib/analysis-engine.js";

describe("visualization safety", () => {
	it("does not display invalid queries as passing", () => {
		expect(analyzeQuery("{", 100).passed).toBe(false);
	});
	it("bounds repeated fragment expansion", () => {
		const fragments = ["fragment F0 on Query { users { id } }"];
		for (let i = 1; i <= 20; i++)
			fragments.push(`fragment F${i} on Query { ...F${i - 1} ...F${i - 1} }`);
		const result = analyzeQuery(`{ ...F20 } ${fragments.join(" ")}`, 100);
		expect(result.error).toContain("node limit");
		expect(result.passed).toBe(false);
	});
});
