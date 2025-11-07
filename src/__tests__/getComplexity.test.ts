import { buildSchema } from "graphql";
import { describe, expect, it } from "vitest";
import { getComplexity, simpleEstimator } from "../index.js";

describe("getComplexity", () => {
  const schema = buildSchema(`
    type Query {
      users(limit: Int): [User!]!
      user(id: ID!): User
    }

    type User {
      id: ID!
      name: String!
      posts(limit: Int): [Post!]!
    }

    type Post {
      id: ID!
      title: String!
    }
  `);

  it("should calculate complexity for a simple query", () => {
    const complexity = getComplexity({
      query: `
        query {
          user(id: "1") {
            id
            name
          }
        }
      `,
      schema,
      estimators: [simpleEstimator({ defaultComplexity: 1 })],
    });

    // user (1) + id (1) + name (1) = 3
    expect(complexity).toBe(3);
  });

  it("should calculate complexity for a nested query", () => {
    const complexity = getComplexity({
      query: `
        query {
          user(id: "1") {
            id
            posts {
              id
              title
            }
          }
        }
      `,
      schema,
      estimators: [simpleEstimator({ defaultComplexity: 1 })],
    });

    // user (1) + id (1) + posts (1) + posts.id (1) + posts.title (1) = 5
    expect(complexity).toBe(5);
  });

  it("should handle variables in complexity calculation", () => {
    const complexity = getComplexity({
      query: `
        query GetUsers($limit: Int!) {
          users(limit: $limit) {
            id
            name
          }
        }
      `,
      schema,
      variables: { limit: 10 },
      estimators: [
        ({ args, childComplexity }) => {
          if (args.limit !== undefined) {
            return args.limit * (1 + childComplexity);
          }
          return undefined;
        },
        simpleEstimator(),
      ],
    });

    // users: 10 * (1 + 2) = 30 (id + name = 2)
    expect(complexity).toBe(30);
  });

  it("should accept DocumentNode as query", async () => {
    const { parse } = await import("graphql");

    const document = parse(`
      query {
        user(id: "1") {
          id
        }
      }
    `);

    const complexity = getComplexity({
      query: document,
      schema,
      estimators: [simpleEstimator({ defaultComplexity: 1 })],
    });

    // user (1) + id (1) = 2
    expect(complexity).toBe(2);
  });

  it("should throw error for invalid queries", () => {
    expect(() => {
      getComplexity({
        query: `
          query {
            nonExistentField {
              id
            }
          }
        `,
        schema,
        estimators: [simpleEstimator()],
      });
    }).toThrow("Query validation failed");
  });

  it("should handle fragments in complexity calculation", () => {
    const complexity = getComplexity({
      query: `
        fragment UserFields on User {
          id
          name
        }

        query {
          user(id: "1") {
            ...UserFields
          }
        }
      `,
      schema,
      estimators: [simpleEstimator({ defaultComplexity: 1 })],
    });

    // user (1) + id (1) + name (1) = 3
    expect(complexity).toBe(3);
  });

  it("should handle @skip and @include directives", () => {
    const complexityWithSkip = getComplexity({
      query: `
        query {
          user(id: "1") {
            id
            name @skip(if: true)
          }
        }
      `,
      schema,
      estimators: [simpleEstimator({ defaultComplexity: 1 })],
    });

    // user (1) + id (1) = 2 (name is skipped)
    expect(complexityWithSkip).toBe(2);

    const complexityWithInclude = getComplexity({
      query: `
        query GetUser($includeName: Boolean!) {
          user(id: "1") {
            id
            name @include(if: $includeName)
          }
        }
      `,
      schema,
      variables: { includeName: false },
      estimators: [simpleEstimator({ defaultComplexity: 1 })],
    });

    // user (1) + id (1) = 2 (name is not included)
    expect(complexityWithInclude).toBe(2);
  });

  it("should work with custom estimators", () => {
    const complexity = getComplexity({
      query: `
        query {
          users(limit: 5) {
            id
            posts(limit: 3) {
              title
            }
          }
        }
      `,
      schema,
      estimators: [
        ({ args, childComplexity }) => {
          const limit = args.limit ?? 1;
          return limit * (1 + childComplexity);
        },
      ],
    });

    // users: 5 * (1 + id + posts)
    // posts: 3 * (1 + title)
    // posts: 3 * (1 + 1) = 6
    // users: 5 * (1 + 1 + 6) = 5 * 8 = 40
    expect(complexity).toBe(40);
  });
});
