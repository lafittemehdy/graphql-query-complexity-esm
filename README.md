# graphql-query-complexity-esm

[![npm version](https://img.shields.io/npm/v/graphql-query-complexity-esm.svg)](https://www.npmjs.com/package/graphql-query-complexity-esm)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Build Status](https://github.com/lafittemehdy/graphql-query-complexity-esm/actions/workflows/test.yml/badge.svg)](https://github.com/lafittemehdy/graphql-query-complexity-esm/actions)

GraphQL query complexity analysis library with native ESM support. Prevents resource-intensive queries from overloading your server by calculating and enforcing complexity limits before execution.

## Features

- Native ESM module with full TypeScript support
- Works as a standard GraphQL validation rule
- Configurable complexity estimators with sensible defaults
- Handles variables, fragments, and directives correctly
- Zero runtime dependencies
- Comprehensive test coverage

## Installation

```bash
npm install graphql-query-complexity-esm
```

## Usage

### Basic Setup

```typescript
import { ApolloServer } from '@apollo/server';
import { createQueryComplexityValidator, simpleEstimator } from 'graphql-query-complexity-esm';

const server = new ApolloServer({
  schema,
  validationRules: [
    createQueryComplexityValidator({
      maximumComplexity: 1000,
      estimators: [simpleEstimator({ defaultComplexity: 1 })],
    }),
  ],
});
```

Queries exceeding the complexity limit are rejected during validation with a descriptive error.

### Programmatic Complexity Calculation

Calculate query complexity without running validation:

```typescript
import { getComplexity, simpleEstimator } from 'graphql-query-complexity-esm';

const complexity = getComplexity({
  query: `
    query GetUsers($limit: Int!) {
      users(limit: $limit) {
        id
        posts {
          title
        }
      }
    }
  `,
  schema,
  variables: { limit: 10 },
  estimators: [simpleEstimator({ defaultComplexity: 1 })],
});

console.log(`Query complexity: ${complexity}`);
```

## Complexity Estimators

Estimators determine how complexity is calculated for each field. Multiple estimators can be chained; the first to return a number is used.

### Built-in Estimators

**simpleEstimator**

Fixed complexity per field:

```typescript
simpleEstimator({ defaultComplexity: 1 })
```

> **⚠️ Important**: `simpleEstimator` does NOT account for list multipliers (e.g., `limit`, `first` arguments). For production use with paginated lists, combine it with a custom estimator that handles multiplication. See the Custom Estimators section below for examples.

**fieldExtensionsEstimator**

Uses field metadata or defaults to `1 + childComplexity`:

```typescript
fieldExtensionsEstimator()
```

### Custom Estimators

Implement custom logic based on field type, arguments, or other factors:

```typescript
const customEstimator: ComplexityEstimator = ({ type, field, args, childComplexity }) => {
  // Scale complexity by pagination limit
  if (field.name === 'users' && args.limit) {
    return args.limit * (1 + childComplexity);
  }

  // Expensive fields get higher cost
  if (field.name === 'search') {
    return 50 + childComplexity;
  }

  // Return undefined to defer to next estimator
  return undefined;
};

createQueryComplexityValidator({
  maximumComplexity: 1000,
  estimators: [
    customEstimator,
    simpleEstimator({ defaultComplexity: 1 }), // fallback
  ],
});
```

## API Reference

### createQueryComplexityValidator(options)

Creates a GraphQL validation rule for complexity analysis.

**Options:**

- `maximumComplexity` (number, required): Maximum allowed query complexity
- `estimators` (ComplexityEstimator[], required): Array of estimator functions
- `schema` (GraphQLSchema, optional): Schema to use (defaults to context schema)
- `variables` (Record<string, any>, optional): Query variables for argument coercion
- `onComplete` ((complexity: number) => void, optional): Callback invoked with final complexity

### getComplexity(options)

Calculates query complexity programmatically.

**Options:**

- `query` (string | DocumentNode, required): GraphQL query to analyze
- `schema` (GraphQLSchema, required): GraphQL schema
- `estimators` (ComplexityEstimator[], required): Array of estimator functions
- `variables` (Record<string, any>, optional): Query variables

**Returns:** number

## How It Works

1. The validator traverses the query AST before execution
2. For each field, estimators are called to determine complexity
3. Directive handling: `@skip` and `@include` are evaluated correctly
4. Fragment spreading: Named and inline fragments are resolved
5. Total complexity is summed and compared against the limit
6. Queries exceeding the limit are rejected with a GraphQL error

## Requirements

- Node.js 18+
- GraphQL 16+

## License

MIT License. Reality’s open source. Do what you want, but remember that every line of code ripples through the universe. Try not to be the bug in existence.
