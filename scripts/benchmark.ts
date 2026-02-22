import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { formatBenchmarkTable, runBenchmarks } from "./benchmark-common.js";

interface CliOptions {
	iterationsScale: number;
	json: boolean;
	outputPath: string | null;
	warmupRuns: number;
}

function parseArgValue(arg: string, flag: string): string | undefined {
	if (arg === flag) return "";
	if (arg.startsWith(`${flag}=`)) return arg.slice(flag.length + 1);
	return undefined;
}

function parseNumberOption(raw: string, name: string): number {
	const value = Number(raw);
	if (!Number.isFinite(value)) {
		throw new TypeError(`${name} must be a finite number, got "${raw}".`);
	}
	return value;
}

function parseIntegerOption(raw: string, name: string): number {
	const value = Number(raw);
	if (!Number.isFinite(value) || !Number.isInteger(value)) {
		throw new TypeError(`${name} must be an integer, got "${raw}".`);
	}
	return value;
}

function parseCliOptions(argv: readonly string[]): CliOptions {
	let iterationsScale = 1;
	let json = false;
	let outputPath: string | null = null;
	let warmupRuns = 75;

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (!arg) continue;

		if (arg === "--json") {
			json = true;
			continue;
		}

		const scaleValue = parseArgValue(arg, "--scale");
		if (scaleValue !== undefined) {
			const raw = scaleValue !== "" ? scaleValue : argv[i + 1];
			if (!raw) throw new TypeError("Missing value for --scale.");
			iterationsScale = parseNumberOption(raw, "scale");
			if (scaleValue === "") i++;
			continue;
		}

		const warmupValue = parseArgValue(arg, "--warmup");
		if (warmupValue !== undefined) {
			const raw = warmupValue !== "" ? warmupValue : argv[i + 1];
			if (!raw) throw new TypeError("Missing value for --warmup.");
			warmupRuns = parseIntegerOption(raw, "warmup");
			if (warmupValue === "") i++;
			continue;
		}

		const outputValue = parseArgValue(arg, "--output");
		if (outputValue !== undefined) {
			const raw = outputValue !== "" ? outputValue : argv[i + 1];
			if (!raw) throw new TypeError("Missing value for --output.");
			outputPath = resolve(raw);
			if (outputValue === "") i++;
			continue;
		}

		throw new TypeError(`Unknown argument: ${arg}`);
	}

	return { iterationsScale, json, outputPath, warmupRuns };
}

const options = parseCliOptions(process.argv.slice(2));

const results = runBenchmarks({
	iterationsScale: options.iterationsScale,
	warmupRuns: options.warmupRuns,
});

if (options.json) {
	const payload = JSON.stringify(
		{
			generatedAt: new Date().toISOString(),
			platform: process.platform,
			results,
			runtime: process.version,
		},
		null,
		2,
	);

	if (options.outputPath) {
		await writeFile(options.outputPath, `${payload}\n`, "utf8");
		console.log(`Wrote benchmark JSON to ${options.outputPath}`);
	} else {
		console.log(payload);
	}
} else {
	console.log("graphql-query-complexity-esm benchmark");
	console.log("");
	console.log(formatBenchmarkTable(results));

	if (options.outputPath) {
		const payload = JSON.stringify(
			{
				generatedAt: new Date().toISOString(),
				platform: process.platform,
				results,
				runtime: process.version,
			},
			null,
			2,
		);
		await writeFile(options.outputPath, `${payload}\n`, "utf8");
		console.log("");
		console.log(`Wrote benchmark JSON to ${options.outputPath}`);
	}
}
