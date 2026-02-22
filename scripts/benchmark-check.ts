import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { formatBenchmarkTable, runBenchmarks } from "./benchmark-common.js";

interface ThresholdConfig {
	iterationsScale?: number;
	maxMsPerRun: Record<string, number>;
	warmupRuns?: number;
}

function isRecordObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseNumberEnv(name: string): number | undefined {
	const raw = process.env[name];
	if (raw === undefined) return undefined;
	const value = Number(raw);
	if (!Number.isFinite(value)) {
		throw new TypeError(`${name} must be a finite number, got "${raw}".`);
	}
	return value;
}

function parseIntegerEnv(name: string): number | undefined {
	const raw = process.env[name];
	if (raw === undefined) return undefined;
	const value = Number(raw);
	if (!Number.isFinite(value) || !Number.isInteger(value)) {
		throw new TypeError(`${name} must be an integer, got "${raw}".`);
	}
	return value;
}

function parseThresholdConfig(value: unknown, path: string): ThresholdConfig {
	if (!isRecordObject(value)) {
		throw new TypeError(`Threshold file ${path} must contain a JSON object.`);
	}

	const maxMsPerRun = value.maxMsPerRun;
	if (!isRecordObject(maxMsPerRun)) {
		throw new TypeError(`Threshold file ${path} must define maxMsPerRun as an object.`);
	}

	const thresholds: Record<string, number> = Object.create(null) as Record<string, number>;
	for (const [name, max] of Object.entries(maxMsPerRun)) {
		if (typeof max !== "number" || !Number.isFinite(max) || max <= 0) {
			throw new TypeError(`Threshold maxMsPerRun.${name} must be a positive number.`);
		}
		thresholds[name] = max;
	}

	const iterationsScale = value.iterationsScale;
	if (
		iterationsScale !== undefined &&
		(typeof iterationsScale !== "number" ||
			!Number.isFinite(iterationsScale) ||
			iterationsScale <= 0)
	) {
		throw new TypeError(`Threshold file ${path} has invalid iterationsScale.`);
	}

	const warmupRuns = value.warmupRuns;
	if (
		warmupRuns !== undefined &&
		(typeof warmupRuns !== "number" ||
			!Number.isFinite(warmupRuns) ||
			!Number.isInteger(warmupRuns))
	) {
		throw new TypeError(`Threshold file ${path} has invalid warmupRuns.`);
	}

	return {
		iterationsScale,
		maxMsPerRun: thresholds,
		warmupRuns,
	};
}

const thresholdPath = resolve(
	process.env.BENCHMARK_THRESHOLDS_PATH ?? "benchmarks/thresholds.json",
);
const rawThresholds = await readFile(thresholdPath, "utf8");
const thresholds = parseThresholdConfig(JSON.parse(rawThresholds), thresholdPath);

const iterationsScale =
	parseNumberEnv("BENCH_ITERATIONS_SCALE") ?? thresholds.iterationsScale ?? 0.45;
const warmupRuns = parseIntegerEnv("BENCH_WARMUP_RUNS") ?? thresholds.warmupRuns ?? 30;

const results = runBenchmarks({ iterationsScale, warmupRuns });

console.log("Benchmark Regression Check");
console.log(`Threshold file: ${thresholdPath}`);
console.log(`Scale: ${iterationsScale}`);
console.log(`Warmup runs: ${warmupRuns}`);
console.log("");
console.log(formatBenchmarkTable(results));

const failures: string[] = [];
for (const result of results) {
	const threshold = thresholds.maxMsPerRun[result.name];
	if (threshold === undefined) {
		failures.push(`Missing threshold for scenario "${result.name}".`);
		continue;
	}

	if (result.msPerRun > threshold) {
		failures.push(
			`Scenario "${result.name}" exceeded max ms/run: ` +
				`${result.msPerRun.toFixed(4)} > ${threshold.toFixed(4)}.`,
		);
	}
}

if (failures.length > 0) {
	console.error("");
	console.error("Benchmark regression detected:");
	for (const failure of failures) {
		console.error(`- ${failure}`);
	}
	process.exit(1);
}

console.log("");
console.log("Benchmark thresholds passed.");
