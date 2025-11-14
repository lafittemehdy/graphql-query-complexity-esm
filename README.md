# graphql-query-complexity-esm

[![npm version](https://img.shields.io/npm/v/graphql-query-complexity-esm.svg)](https://www.npmjs.com/package/graphql-query-complexity-esm)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Build Status](https://github.com/lafittemehdy/graphql-query-complexity-esm/actions/workflows/test.yml/badge.svg)](https://github.com/lafittemehdy/graphql-query-complexity-esm/actions)

Protect your GraphQL API by rejecting expensive queries before execution.

Calculates a complexity score during GraphQL validation and rejects queries that exceed your limit. A lightweight, zero-dependency library that works with any GraphQL server (Apollo, Yoga, etc.) with native ESM and TypeScript support.

## Features

- **Native ESM & TypeScript:** Modern module support with full type safety
- **Works Anywhere:** Compatible with any GraphQL-compliant server (Apollo, Yoga, etc.)
- **Flexible Estimation:** Schema directives, custom logic, or simple defaults
- **Complete GraphQL Support:** Variables, fragments, and directives (`@skip`, `@include`)
- **Zero Dependencies:** Lightweight and focused (small bundle size)
- **Well Tested:** Comprehensive test suite

## Installation

```bash
npm install graphql-query-complexity-esm
```

## Quick Start

### Apollo Server Integration

This example uses an Apollo Server plugin with the `didResolveOperation` hook. This is the recommended approach because validation rules alone don't have access to request variables, which are needed for accurate complexity calculation.

```typescript
import { ApolloServer } from '@apollo/server';
import { startStandaloneServer } from '@apollo/server/standalone';
import { GraphQLError } from 'graphql';
import {
  fieldExtensionsEstimator,
  getComplexity,
  simpleEstimator,
} from 'graphql-query-complexity-esm';

// Step 1: Define your schema
const typeDefs = `#graphql
  directive @complexity(
    value: Int!
    multipliers: [String!]
  ) on FIELD_DEFINITION

  type Query {
    posts: [Post!]! @complexity(value: 5)
    users(limit: Int): [User!]! @complexity(value: 2, multipliers: ["limit"])
  }

  type User {
    id: ID!
    name: String!
  }

  type Post {
    id: ID!
    title: String!
  }
`;

// Step 2: Define your resolvers
const resolvers = {
  Query: {
    posts: () => [{ id: '1', title: 'Hello World' }],
    users: (_: unknown, { limit }: { limit?: number }) =>
      Array.from({ length: limit || 0 }, (_, i) => ({
        id: String(i + 1),
        name: `User ${i + 1}`,
      })),
  },
};

// Step 3: Create and start the server
const server = new ApolloServer({
  typeDefs,
  resolvers,
  plugins: [
    {
      async requestDidStart({ schema }) {
        return {
          async didResolveOperation({ request, document }) {
            const complexity = getComplexity({
              query: document,
              schema,
              estimators: [
                fieldExtensionsEstimator(),
                simpleEstimator({ defaultComplexity: 1 }),
              ],
              variables: request.variables || {},
            });

            console.log(`Query complexity: ${complexity}`);

            const maximumComplexity = 1000;
            if (complexity > maximumComplexity) {
              throw new GraphQLError(
                `Query exceeds maximum complexity of ${maximumComplexity}. Actual: ${complexity}.`,
                {
                  extensions: {
                    code: 'QUERY_TOO_COMPLEX',
                    complexity,
                    maximumComplexity,
                  },
                },
              );
            }
          },
        };
      },
    },
  ],
});

const { url } = await startStandaloneServer(server, {
  listen: { port: 4000 },
});

console.log(`🚀 Server ready at: ${url}`);
```

## How It Works

The library calculates a complexity score during GraphQL validation (before execution). Expensive queries are rejected before hitting your business logic.

**Process:**
1. Client sends a query
2. Server parses and validates the query
3. **Query complexity calculation runs** (this library)
4. If validation passes, query executes

The library traverses the query AST using **estimators** to calculate cost. It correctly handles fragments and directives (`@skip`, `@include`), counting only fields that will actually be resolved.

---

## Estimation Methods

### The `@complexity` Directive

Define complexity in your schema using the `@complexity` directive:

```graphql
directive @complexity(
  value: Int!
  multipliers: [String!]
) on FIELD_DEFINITION

type Query {
  posts: [Post] @complexity(value: 5)
  users(limit: Int): [User] @complexity(value: 2, multipliers: ["limit"])
}
```

- `value`: Base complexity cost
- `multipliers`: Arguments that scale the cost (e.g., pagination limits)

### Method 1 (Recommended): `fieldExtensionsEstimator`

Reads complexity from the `@complexity` directive. Pair with `simpleEstimator` as a fallback:

```typescript
import {
  createQueryComplexityValidator,
  fieldExtensionsEstimator,
  simpleEstimator,
} from 'graphql-query-complexity-esm';

const complexityValidator = createQueryComplexityValidator({
  maximumComplexity: 1000,
  estimators: [
    fieldExtensionsEstimator(), // Reads @complexity directive
    simpleEstimator({ defaultComplexity: 1 }), // Fallback for fields without directive
  ],
});
```

### Method 2: Custom Estimator

Write your own estimator function for dynamic rules or security patterns.

**Minimal Example:**

```typescript
import type { ComplexityEstimator } from 'graphql-query-complexity-esm';

const customEstimator: ComplexityEstimator = ({ field }) => {
  if (field.name === 'expensiveOperation') return 500;
  return undefined; // Fall through to next estimator
};

const estimators = [customEstimator, simpleEstimator({ defaultComplexity: 1 })];
```

**Advanced: Automatic Pagination**

This estimator detects list fields and applies multipliers automatically:

```typescript
const smartPaginationEstimator: ComplexityEstimator = ({ field, args, childComplexity }) => {
  if (field.name.endsWith('Connection') || field.name.endsWith('s')) {
    const limit = typeof args.limit === 'number' ? args.limit : 10;

    // Optional: Security rule
    if (limit > 100) return 99999;

    return limit * childComplexity;
  }
  return undefined;
};

const estimators = [smartPaginationEstimator, simpleEstimator({ defaultComplexity: 1 })];
```

### Method 3: `simpleEstimator`

Assigns a fixed complexity to every field. Use as a fallback estimator or for simple schemas with uniform costs.

```typescript
const estimators = [simpleEstimator({ defaultComplexity: 1 })];
```

**Warning:** Using `simpleEstimator` alone doesn't protect against list-based attacks (e.g., `users(limit: 999999)`).

## Query Cost Examples

**Schema:**
```graphql
type Query {
  users(limit: Int): [User!]! @complexity(value: 1, multipliers: ["limit"])
  adminSearch: [User!]! @complexity(value: 10)
}

type User {
  id: ID!
  name: String!
  posts(last: Int): [Post!]! @complexity(value: 1, multipliers: ["last"])
}

type Post {
  title: String!
}
```

**Estimators:**
```typescript
const estimators = [
  fieldExtensionsEstimator(),
  simpleEstimator({ defaultComplexity: 1 }), // Fallback for id, name, title
];
```

| Query | Calculation | Total |
| :--- | :--- | :--- |
| `{ users(limit: 10) { id } }` | `users`: 1 + (10 × `id`:1) = 1 + 10 | **11** |
| `{ users(limit: 20) { id name } }` | `users`: 1 + (20 × (`id`:1 + `name`:1)) = 1 + 40 | **41** |
| `{ adminSearch { id } }` | `adminSearch`: 10 + `id`:1 | **11** |
| `{ users(limit: 5) { posts(last: 3) { title } } }` | `users`: 1 + (5 × (`posts`: 1 + (3 × `title`:1))) = 1 + (5 × 4) | **21** |

## Calculate Complexity Programmatically

Calculate query complexity without running a server. Useful for testing, analysis, or custom validation.

The `getComplexity` function returns the query complexity score or throws `QueryComplexityValidationError` for invalid queries (syntax errors, undefined fields).

**Note:** `buildSchema` works with the `@complexity` directive for `fieldExtensionsEstimator`. For more advanced directive features, use `makeExecutableSchema` from `@graphql-tools/schema`.

```typescript
import {
  getComplexity,
  fieldExtensionsEstimator,
  simpleEstimator,
  QueryComplexityValidationError,
} from 'graphql-query-complexity-esm';
import { buildSchema } from 'graphql';

const schema = buildSchema(`
  directive @complexity(value: Int!, multipliers: [String!]) on FIELD_DEFINITION

  type Query {
    users(limit: Int): [User] @complexity(value: 1, multipliers: ["limit"])
  }

  type User {
    id: ID
    posts(last: Int): [Post] @complexity(value: 1, multipliers: ["last"])
  }

  type Post {
    title: String
  }
`);

const query = `
  query ($limit: Int!, $last: Int!) {
    users(limit: $limit) {
      id
      posts(last: $last) {
        title
      }
    }
  }
`;

try {
  const complexity = getComplexity({
    query, // String or DocumentNode
    schema,
    variables: { limit: 10, last: 5 },
    estimators: [
      fieldExtensionsEstimator(),
      simpleEstimator({ defaultComplexity: 1 }),
    ],
  });

  // Calculation: users: 1 + (10 * (id:1 + posts:1 + (5 * title:1))) = 71
  console.log(complexity); // 71
} catch (error) {
  if (error instanceof QueryComplexityValidationError) {
    console.error('Query is invalid:', error.errors);
  }
}
```

## API Reference

### `createQueryComplexityValidator(options)`

Creates a GraphQL validation rule.

- `maximumComplexity` (number, **required**) - Maximum allowed complexity
- `estimators` (ComplexityEstimator[], **required**) - Array of estimator functions
- `schema` (GraphQLSchema, optional) - Schema (inferred from context if not provided)
- `variables` (Record<string, unknown>, optional) - Query variables
- `onComplete` ((complexity: number) => void, optional) - Callback fired after calculation
- `maximumNodeCount` (number, optional, default: 10000) - Safeguard against extremely large queries

### `getComplexity(options)`

Calculates query complexity programmatically.

- `query` (string | DocumentNode, **required**) - Query string or AST
- `schema` (GraphQLSchema, **required**) - GraphQL schema
- `estimators` (ComplexityEstimator[], **required**) - Array of estimator functions
- `variables` (Record<string, unknown>, optional) - Query variables
- `maximumNodeCount` (number, optional, default: 10000) - Safeguard against extremely large queries

**Returns:** `number` - Calculated complexity score

**Throws:** `QueryComplexityValidationError` - For invalid queries (syntax errors, undefined fields)

```typescript
import { getComplexity, QueryComplexityValidationError } from 'graphql-query-complexity-esm';

try {
  const complexity = getComplexity({ query, schema, estimators });
} catch (e) {
  if (e instanceof QueryComplexityValidationError) {
    console.log('Validation errors:', e.errors);
  }
}
```

## Requirements

- Node.js 18+
- GraphQL 16+

## Examples

A complete TypeScript example with Apollo Server is available in the [`examples/apollo-server`](examples/apollo-server) directory.

**Quick start:**

```bash
# From the root directory
pnpm run example
```

The example includes:
- Full TypeScript setup with proper type definitions
- Complete Apollo Server integration with `didResolveOperation` hook
- Schema with `@complexity` directive
- Working resolvers
- Test queries with complexity calculations
- Error handling examples

See the [Apollo Server Example README](examples/apollo-server/README.md) for detailed instructions.

## License

MIT License. Reality’s open source. Do what you want, but remember that every line of code ripples through the universe. Try not to be the bug in existence.
