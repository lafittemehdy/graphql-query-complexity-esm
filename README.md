# graphql-query-complexity-esm

[![CI](https://github.com/lafittemehdy/graphql-query-complexity-esm/actions/workflows/ci.yml/badge.svg)](https://github.com/lafittemehdy/graphql-query-complexity-esm/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/graphql-query-complexity-esm)](https://www.npmjs.com/package/graphql-query-complexity-esm)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

GraphQL APIs are vulnerable to expensive queries — a deeply nested or fan-out query can consume resources far beyond what a simple rate limit catches. `graphql-query-complexity-esm` assigns a cost score to every field and rejects queries that exceed a budget **before a single resolver runs**.

- **Validation rule** (`complexityLimit`) — plug into any GraphQL server's validate pipeline
- **Programmatic API** (`getComplexity`, `getComplexityBreakdown`) — analyze costs outside validation
- **Estimator chains** — first estimator returning a finite number wins; return `undefined` to defer
- **Built-in estimators**: `simpleEstimator` (fixed cost per field) and `fieldExtensionsEstimator` (`@complexity` directive or `field.extensions.complexity`)
- **Directive-aware**: honors `@skip` and `@include` during traversal
- **Fragment support**: named fragments, inline fragments, per-path cycle protection
- **Node-count guard**: configurable `maxNodes` (default `10_000`) prevents AST explosion
- **Typed error codes**: `ESTIMATOR_ERROR`, `NODE_LIMIT_EXCEEDED`, `QUERY_TOO_COMPLEX`
- **TypeScript**: ships with `.d.ts` declarations; works with plain JavaScript too
- **Dual publish**: ESM + CJS from the same package

## Requirements

- Node.js `>=22.0.0`
- Peer dependency: `graphql ^16.0.0`

## Installation

```bash
npm install graphql-query-complexity-esm graphql
```

```bash
pnpm add graphql-query-complexity-esm graphql
```

```bash
yarn add graphql-query-complexity-esm graphql
```

## Quickstart

```ts
import { buildSchema, parse, specifiedRules, validate } from "graphql";
import { complexityLimit, simpleEstimator } from "graphql-query-complexity-esm";

const schema = buildSchema(`
  type Query {
    users(limit: Int): [User!]!
  }
  type User {
    id: ID!
    name: String!
  }
`);

const rule = complexityLimit(1000, {
  estimators: [simpleEstimator({ defaultComplexity: 1 })],
  variables: {},
});

const document = parse(`query { users(limit: 10) { id name } }`);
const errors = validate(schema, document, [...specifiedRules, rule]);

if (errors.length > 0) {
  console.error("Query rejected:", errors[0].message);
}
```

## API Reference

### `complexityLimit(maxComplexity, options?, callback?)`

Creates a GraphQL validation rule that rejects queries exceeding a maximum complexity score.

`maxComplexity` — required, must be a positive integer.

**Options:**

| Option | Type | Default | Validation |
|---|---|---|---|
| `defaultComplexity` | `number` | `1` | Non-negative integer |
| `estimators` | `ComplexityEstimator[]` | `[simpleEstimator({ defaultComplexity })]` | Non-empty array of functions |
| `maxNodes` | `number` | `10_000` | Positive integer |
| `variables` | `Record<string, unknown>` | `{}` | Plain object |

**Callback:**

Optional `ComplexityCallback` — called once on document leave, only when this rule did not report an error. Receives a `ComplexityByOperation` map of operation names to complexity scores.

Anonymous operations receive deterministic keys: the first is `"[anonymous]"`, subsequent ones are `"[anonymous:2]"`, `"[anonymous:3]"`, etc.

```ts
const rule = complexityLimit(
  1000,
  {
    estimators: [fieldExtensionsEstimator(), simpleEstimator({ defaultComplexity: 1 })],
    variables: request.variables ?? {},
  },
  (complexities) => {
    for (const [name, cost] of Object.entries(complexities)) {
      console.log(`${name}: ${cost}`);
    }
  },
);
```

### `getComplexity(options)` / `getComplexityBreakdown(options)`

Programmatic complexity calculation outside the server validation flow.

| Option | Type | Required | Default | Validation |
|---|---|---|---|---|
| `estimators` | `ComplexityEstimator[]` | yes | — | Non-empty array of functions |
| `query` | `string \| DocumentNode` | yes | — | String or `DocumentNode` |
| `schema` | `GraphQLSchema` | yes | — | GraphQL schema instance |
| `maxNodes` | `number` | no | `10_000` | Positive integer |
| `variables` | `Record<string, unknown>` | no | `{}` | Plain object |

- `getComplexity()` — returns the highest complexity score among all operations.
- `getComplexityBreakdown()` — returns a frozen `ComplexityByOperation` map.

Both throw `QueryComplexityValidationError` on parse/validation failures:

```ts
import {
  getComplexity,
  QueryComplexityValidationError,
  simpleEstimator,
} from "graphql-query-complexity-esm";

try {
  const cost = getComplexity({
    estimators: [simpleEstimator({ defaultComplexity: 1 })],
    query: `{ users { id name } }`,
    schema,
  });
  console.log("Query cost:", cost);
} catch (error) {
  if (error instanceof QueryComplexityValidationError) {
    // error.errors  — readonly GraphQLError[]
    // error.message — all error messages joined with newline
    console.error(error.errors);
  }
}
```

### `fieldExtensionsEstimator()`

Reads cost from `field.extensions.complexity` or the `@complexity` directive.

**Resolution order** (first match wins):

1. `field.extensions.complexity` as a finite number → `value + childComplexity`
2. `field.extensions.complexity` as `{ value: number, multipliers?: string[] }` → cost formula
3. `@complexity` directive on the field definition → cost formula
4. Returns `undefined` (defers to the next estimator)

**Cost formula:**

```
cost = value + (product of multiplier argument values, default 1) * childComplexity
```

```ts
// Programmatic extensions (code-first schemas)
field.extensions = { complexity: 10 };                              // flat number
field.extensions = { complexity: { value: 2, multipliers: ["limit"] } }; // with multipliers
```

```graphql
# Directive (SDL-first schemas) — add complexityDirectiveTypeDefs to your schema
type Query {
  users(limit: Int): [User!]! @complexity(value: 2, multipliers: ["limit"])
}
```

### `simpleEstimator(options?)`

Assigns a fixed base cost to every field and adds child complexity on top.

- `defaultComplexity` — base cost per field (default `1`)
- Formula: `cost + childComplexity`

> **Note:** This estimator does not account for list multipliers. Fields returning lists (e.g. `users(limit: 100)`) receive the same cost as scalar fields. Use `fieldExtensionsEstimator` or a custom estimator for accurate list costing.

### `complexityDirectiveTypeDefs`

SDL string for the `@complexity` directive. Add to your schema type definitions when using directive-based costs with `fieldExtensionsEstimator`:

```graphql
directive @complexity(value: Int!, multipliers: [String!]) on FIELD_DEFINITION
```

### `ERROR_CODES`

Frozen object with GraphQL error extension codes:

| Code | Trigger |
|---|---|
| `ESTIMATOR_ERROR` | An estimator threw during evaluation |
| `NODE_LIMIT_EXCEEDED` | Query exceeded `maxNodes` |
| `QUERY_TOO_COMPLEX` | Query exceeded `maxComplexity` |

### Exports

**Runtime:**

| Export | Description |
|---|---|
| `complexityDirectiveTypeDefs` | SDL for the `@complexity` directive |
| `complexityLimit` | Validation rule factory |
| `ERROR_CODES` | Error extension codes |
| `fieldExtensionsEstimator` | Extension/directive-based estimator |
| `getComplexity` | Programmatic max complexity |
| `getComplexityBreakdown` | Programmatic per-operation breakdown |
| `QueryComplexityValidationError` | Error class for validation failures |
| `simpleEstimator` | Fixed-cost estimator |

**Types:**

| Export | Description |
|---|---|
| `ComplexityByOperation` | Operation-name → complexity map |
| `ComplexityCallback` | Callback signature |
| `ComplexityEstimator` | Estimator function signature |
| `ComplexityEstimatorArgs` | Arguments passed to estimators |
| `ComplexityExtensionConfig` | `{ value, multipliers? }` shape |
| `ComplexityLimitFunction` | Overloaded `complexityLimit` signature |
| `ComplexityLimitOptions` | Options for `complexityLimit` |
| `GetComplexityOptions` | Options for `getComplexity*` |

## Integration Examples

### Apollo Server

Uses `getComplexity()` inside a `didResolveOperation` plugin hook to reject expensive queries before execution. [Full example](https://github.com/lafittemehdy/graphql-query-complexity-esm/blob/master/examples/servers/apollo-server.ts)

```ts
import { GraphQLError } from "graphql";
import {
  fieldExtensionsEstimator,
  getComplexity,
  simpleEstimator,
} from "graphql-query-complexity-esm";

const MAX_COMPLEXITY = 1000;

// Inside ApolloServer config:
const server = new ApolloServer({
  plugins: [
    {
      async requestDidStart({ schema }) {
        return {
          async didResolveOperation({ document, request }) {
            const complexity = getComplexity({
              estimators: [fieldExtensionsEstimator(), simpleEstimator({ defaultComplexity: 1 })],
              query: document,
              schema,
              variables: request.variables ?? {},
            });

            if (complexity > MAX_COMPLEXITY) {
              throw new GraphQLError(
                `Query complexity ${complexity} exceeds maximum of ${MAX_COMPLEXITY}.`,
                { extensions: { code: "QUERY_TOO_COMPLEX", complexity, maximumComplexity: MAX_COMPLEXITY } },
              );
            }
          },
        };
      },
    },
  ],
  // ...
});
```

### GraphQL Yoga

Uses `complexityLimit()` as a validation rule via the `onValidate` plugin hook. [Full example](https://github.com/lafittemehdy/graphql-query-complexity-esm/blob/master/examples/servers/yoga-server.ts)

```ts
import {
  complexityLimit,
  fieldExtensionsEstimator,
  simpleEstimator,
} from "graphql-query-complexity-esm";

const MAX_COMPLEXITY = 1000;

// Inside createYoga config:
const yoga = createYoga({
  plugins: [
    {
      onValidate({ addValidationRule, params }) {
        const variables = (params.variables as Record<string, unknown> | undefined) ?? {};

        addValidationRule(
          complexityLimit(MAX_COMPLEXITY, {
            estimators: [fieldExtensionsEstimator(), simpleEstimator({ defaultComplexity: 1 })],
            variables,
          }),
        );
      },
    },
  ],
  // ...
});
```

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `RangeError: maxComplexity must be a positive integer` | Invalid first argument to `complexityLimit` | Pass a positive integer |
| `RangeError` / `TypeError` from option validation | Invalid option types | Verify `estimators`, `maxNodes`, `variables` shapes |
| `QueryComplexityValidationError` thrown | Parse or validation failure in `getComplexity*` | Inspect `error.errors` for GraphQL error details |
| Extension code `QUERY_TOO_COMPLEX` | Complexity exceeded `maxComplexity` | Increase limit or tune estimators |
| Extension code `NODE_LIMIT_EXCEEDED` | Query exceeded `maxNodes` | Increase `maxNodes` or reduce query breadth/depth |
| Extension code `ESTIMATOR_ERROR` | An estimator threw | Guard estimator logic against unexpected arguments |
| `@skip`/`@include` with missing variables | Directive coercion failure | Nodes are treated as included; pass all required variables |

## Development

<details>
<summary><strong>Scripts</strong></summary>

**Build:**

| Script | Command |
|---|---|
| `build` | `tsup` |
| `dev` | `tsc --watch` |

**Lint:**

| Script | Command |
|---|---|
| `lint` | `biome check && tsc --noEmit` |
| `lint:fix` | `biome check --write && tsc --noEmit` |

**Test:**

| Script | Command |
|---|---|
| `test` | `vitest run` |
| `test:coverage` | `vitest run --coverage` |
| `test:ui` | `vitest --ui` |
| `test:watch` | `vitest` |

**Benchmark:**

| Script | Command |
|---|---|
| `bench` | `tsx scripts/benchmark.ts` |
| `bench:check` | `tsx scripts/benchmark-check.ts` |
| `bench:json` | `tsx scripts/benchmark.ts --json` |

**Examples:**

| Script | Command |
|---|---|
| `example:apollo` | `tsx examples/servers/apollo-server.ts` |
| `example:yoga` | `tsx examples/servers/yoga-server.ts` |

</details>

<details>
<summary><strong>Architecture</strong></summary>

| Module | Purpose |
|---|---|
| `src/index.ts` | Public runtime and type exports |
| `src/complexity-rule.ts` | `complexityLimit` factory, input validation, callback dispatch, error reporting |
| `src/complexity-engine.ts` | Iterative traversal engine, estimator execution, fragment processing, node counting |
| `src/get-complexity.ts` | Programmatic wrapper around `validate()` + `complexityLimit()` |
| `src/estimators.ts` | `simpleEstimator` and `fieldExtensionsEstimator` |
| `src/directives.ts` | `complexityDirectiveTypeDefs`, `shouldSkipNode` (`@skip`/`@include`) |
| `src/constants.ts` | `DEFAULT_MAX_NODES`, `ERROR_CODES` |
| `src/types.ts` | Public interfaces, types, and `QueryComplexityValidationError` |
| `src/__tests__/` | Behavior tests for all modules |

**Build output:** `src/index.ts` → `tsup` → `dist/` (ESM + CJS + `.d.ts` + sourcemaps)

</details>

<details>
<summary><strong>Benchmark</strong></summary>

```bash
pnpm bench
```

**CLI arguments** (`scripts/benchmark.ts`):

| Argument | Description |
|---|---|
| `--json` | Output results as JSON |
| `--output <path>` | Write results to file |
| `--scale <number>` | Iteration scale factor |
| `--warmup <integer>` | Number of warmup runs |

**Regression check** (`pnpm bench:check`) **env vars:**

| Variable | Default | Purpose |
|---|---|---|
| `BENCHMARK_THRESHOLDS_PATH` | `benchmarks/thresholds.json` | Path to thresholds JSON |
| `BENCH_ITERATIONS_SCALE` | Thresholds file value, then `0.45` | Iteration scale override |
| `BENCH_WARMUP_RUNS` | Thresholds file value, then `30` | Warmup runs override |

</details>

## License

MIT
