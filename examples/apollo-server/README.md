# Apollo Server Example (TypeScript)

This example demonstrates how to integrate `graphql-query-complexity-esm` with Apollo Server using TypeScript.

## Setup

```bash
pnpm install
```

## Build

```bash
pnpm run build
```

## Run

```bash
pnpm start
```

Or build and run in one command:

```bash
pnpm run dev
```

The server will start at [http://localhost:4000](http://localhost:4000)

## Test Queries

### Simple Query (Low Complexity)

```graphql
query {
  posts {
    id
    title
  }
}
```

**Complexity:** 7 (5 for posts + 2 for id and title)

### Query with Variables (Medium Complexity)

```graphql
query GetUsers($limit: Int!) {
  users(limit: $limit) {
    id
    name
  }
}
```

**Variables:**
```json
{ "limit": 10 }
```

**Complexity:** 22 (2 + 10 × 2)

### High Complexity Query (Should Fail)

```graphql
query GetManyUsers($limit: Int!) {
  users(limit: $limit) {
    id
    name
  }
}
```

**Variables:**
```json
{ "limit": 500 }
```

**Complexity:** 1002 (2 + 500 × 2) - **Exceeds limit of 1000**

This query will be rejected with error:
```json
{
  "errors": [
    {
      "message": "Query exceeds maximum complexity of 1000. Actual: 1002.",
      "extensions": {
        "code": "QUERY_TOO_COMPLEX",
        "complexity": 1002,
        "maximumComplexity": 1000
      }
    }
  ]
}
```
