import { performance } from "node:perf_hooks";
import { buildSchema, parse } from "graphql";
import { getComplexity, simpleEstimator } from "../src/index.js";

export interface BenchmarkScenario {
	iterations: number;
	name: string;
	query: string;
}

export interface BenchmarkResult {
	complexity: number;
	iterations: number;
	msPerRun: number;
	name: string;
	opsPerSecond: number;
	totalMs: number;
}

export interface RunBenchmarksOptions {
	iterationsScale?: number;
	scenarios?: readonly BenchmarkScenario[];
	warmupRuns?: number;
}

const schema = buildSchema(`
	type Query {
		user(id: ID!): User
		users(limit: Int): [User!]!
	}

	type User {
		friends: [User!]!
		id: ID!
		name: String!
		posts(limit: Int): [Post!]!
	}

	type Post {
		comments(limit: Int): [Comment!]!
		id: ID!
		title: String!
	}

	type Comment {
		author: User!
		id: ID!
		text: String!
	}
`);

const estimators = [simpleEstimator({ defaultComplexity: 1 })];

function createDeepQuery(depth: number): string {
	let selection = "id";
	for (let i = 0; i < depth; i++) {
		selection = `id friends { ${selection} }`;
	}
	return `query Deep { user(id: "1") { ${selection} } }`;
}

function createWideQuery(aliasCount: number): string {
	const fields: string[] = [];
	for (let i = 0; i < aliasCount; i++) {
		fields.push(`id${i}: id`);
	}
	return `query Wide { user(id: "1") { ${fields.join(" ")} } }`;
}

export const DEFAULT_SCENARIOS: readonly BenchmarkScenario[] = [
	{
		iterations: 6000,
		name: "small",
		query: `query Small { user(id: "1") { id name } }`,
	},
	{
		iterations: 3000,
		name: "medium",
		query: `query Medium { users(limit: 20) { id name posts(limit: 5) { id title } } }`,
	},
	{
		iterations: 1800,
		name: "deep",
		query: createDeepQuery(18),
	},
	{
		iterations: 1400,
		name: "wide",
		query: createWideQuery(250),
	},
	{
		iterations: 900,
		name: "heavy",
		query: `query Heavy {
			users(limit: 40) {
				id
				name
				posts(limit: 15) {
					id
					title
					comments(limit: 8) {
						id
						text
						author {
							id
							name
						}
					}
				}
			}
		}`,
	},
];

function formatNumber(value: number, digits = 2): string {
	return value.toFixed(digits);
}

function normalizeScale(value: number | undefined): number {
	const scale = value ?? 1;
	if (!Number.isFinite(scale) || scale <= 0) {
		throw new RangeError(`iterationsScale must be a positive number, got ${scale}.`);
	}
	return scale;
}

function normalizeWarmupRuns(value: number | undefined): number {
	const warmupRuns = value ?? 75;
	if (!Number.isFinite(warmupRuns) || !Number.isInteger(warmupRuns) || warmupRuns < 0) {
		throw new RangeError(`warmupRuns must be a non-negative integer, got ${warmupRuns}.`);
	}
	return warmupRuns;
}

function scaleIterations(baseIterations: number, scale: number): number {
	return Math.max(1, Math.round(baseIterations * scale));
}

function runScenario(scenario: BenchmarkScenario, warmupRuns: number): BenchmarkResult {
	const document = parse(scenario.query);

	for (let i = 0; i < warmupRuns; i++) {
		getComplexity({
			estimators,
			query: document,
			schema,
		});
	}

	let complexity = 0;
	const start = performance.now();
	for (let i = 0; i < scenario.iterations; i++) {
		complexity = getComplexity({
			estimators,
			query: document,
			schema,
		});
	}
	const totalMs = performance.now() - start;

	return {
		complexity,
		iterations: scenario.iterations,
		msPerRun: totalMs / scenario.iterations,
		name: scenario.name,
		opsPerSecond: (scenario.iterations * 1000) / totalMs,
		totalMs,
	};
}

export function runBenchmarks(options: RunBenchmarksOptions = {}): BenchmarkResult[] {
	const scenarios = options.scenarios ?? DEFAULT_SCENARIOS;
	const scale = normalizeScale(options.iterationsScale);
	const warmupRuns = normalizeWarmupRuns(options.warmupRuns);

	return scenarios.map((scenario) =>
		runScenario(
			{
				...scenario,
				iterations: scaleIterations(scenario.iterations, scale),
			},
			warmupRuns,
		),
	);
}

export function formatBenchmarkTable(results: readonly BenchmarkResult[]): string {
	const lines = [
		[
			"scenario".padEnd(12),
			"complexity".padStart(10),
			"iterations".padStart(12),
			"total(ms)".padStart(12),
			"ms/run".padStart(10),
			"ops/sec".padStart(12),
		].join(" "),
	];

	for (const result of results) {
		lines.push(
			[
				result.name.padEnd(12),
				String(result.complexity).padStart(10),
				String(result.iterations).padStart(12),
				formatNumber(result.totalMs).padStart(12),
				formatNumber(result.msPerRun, 4).padStart(10),
				formatNumber(result.opsPerSecond).padStart(12),
			].join(" "),
		);
	}

	return lines.join("\n");
}
