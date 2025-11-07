import { buildSchema, parse, validate } from "graphql";
import { describe, expect, it, vi } from "vitest";
import {
  createQueryComplexityValidator,
  fieldExtensionsEstimator,
  simpleEstimator,
} from "../index.js";

describe("QueryComplexity", () => {
  const schema = buildSchema(`
    type Query {
      users(limit: Int): [User!]!
      user(id: ID!): User
      posts(limit: Int, offset: Int): [Post!]!
    }

    type User {
      id: ID!
      name: String!
      posts(limit: Int): [Post!]!
      friends: [User!]!
    }

    type Post {
      id: ID!
      title: String!
      content: String!
      author: User!
      comments(limit: Int): [Comment!]!
    }

    type Comment {
      id: ID!
      text: String!
      author: User!
    }
  `);

  describe("Basic Complexity Calculation", () => {
    it("should calculate simple query complexity", () => {
      const query = `
        query {
          user(id: "1") {
            id
            name
          }
        }
      `;

      const document = parse(query);
      let calculatedComplexity = 0;

      const complexityRule = createQueryComplexityValidator({
        maximumComplexity: 100,
        estimators: [simpleEstimator({ defaultComplexity: 1 })],
        schema,
        onComplete: (complexity) => {
          calculatedComplexity = complexity;
        },
      });

      const errors = validate(schema, document, [complexityRule]);

      expect(errors).toHaveLength(0);
      // user (1) + id (1) + name (1) = 3
      expect(calculatedComplexity).toBe(3);
    });

    it("should calculate nested query complexity", () => {
      const query = `
        query {
          user(id: "1") {
            id
            name
            posts(limit: 10) {
              id
              title
            }
          }
        }
      `;

      const document = parse(query);
      let calculatedComplexity = 0;

      const complexityRule = createQueryComplexityValidator({
        maximumComplexity: 100,
        estimators: [simpleEstimator({ defaultComplexity: 1 })],
        schema,
        onComplete: (complexity) => {
          calculatedComplexity = complexity;
        },
      });

      const errors = validate(schema, document, [complexityRule]);

      expect(errors).toHaveLength(0);
      // user (1) + id (1) + name (1) + posts (1) + posts.id (1) + posts.title (1) = 6
      expect(calculatedComplexity).toBe(6);
    });

    it("should reject queries exceeding maximum complexity", () => {
      const query = `
        query {
          users(limit: 100) {
            id
            name
            posts(limit: 100) {
              id
              title
              comments(limit: 100) {
                id
                text
              }
            }
          }
        }
      `;

      const document = parse(query);

      const complexityRule = createQueryComplexityValidator({
        maximumComplexity: 5,
        estimators: [simpleEstimator({ defaultComplexity: 1 })],
        schema,
      });

      const errors = validate(schema, document, [complexityRule]);

      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain("exceeds maximum complexity");
      expect(errors[0].extensions?.code).toBe("QUERY_TOO_COMPLEX");
    });
  });

  describe("Variable Handling", () => {
    it("should handle variables in arguments", () => {
      const query = `
        query GetUsers($limit: Int!) {
          users(limit: $limit) {
            id
            name
          }
        }
      `;

      const document = parse(query);
      let receivedArgs: any = null;

      const customEstimator = vi.fn(({ args, childComplexity }) => {
        if (args.limit !== undefined) {
          receivedArgs = args;
          return args.limit * (1 + childComplexity);
        }
        return undefined;
      });

      const complexityRule = createQueryComplexityValidator({
        maximumComplexity: 1000,
        estimators: [customEstimator, simpleEstimator()],
        schema,
        variables: { limit: 10 },
      });

      const errors = validate(schema, document, [complexityRule]);

      expect(errors).toHaveLength(0);
      expect(customEstimator).toHaveBeenCalled();
      expect(receivedArgs).toEqual({ limit: 10 });
    });

    it("should handle missing variables with default values", () => {
      const query = `
        query GetUsers($limit: Int = 5) {
          users(limit: $limit) {
            id
          }
        }
      `;

      const document = parse(query);
      let _receivedArgs: any = null;

      const customEstimator = ({ args, childComplexity }: any) => {
        if (args.limit !== undefined) {
          _receivedArgs = args;
          return args.limit * (1 + childComplexity);
        }
        return undefined;
      };

      const complexityRule = createQueryComplexityValidator({
        maximumComplexity: 1000,
        estimators: [customEstimator, simpleEstimator()],
        schema,
        variables: {}, // No variables provided, should use default
      });

      const errors = validate(schema, document, [complexityRule]);

      expect(errors).toHaveLength(0);
      // Note: Default values are handled by GraphQL validation, not our complexity validator
    });
  });

  describe("Directive Support", () => {
    it("should skip fields with @skip(if: true)", () => {
      const query = `
        query {
          user(id: "1") {
            id
            name @skip(if: true)
            posts {
              id
            }
          }
        }
      `;

      const document = parse(query);
      let calculatedComplexity = 0;

      const complexityRule = createQueryComplexityValidator({
        maximumComplexity: 100,
        estimators: [simpleEstimator({ defaultComplexity: 1 })],
        schema,
        onComplete: (complexity) => {
          calculatedComplexity = complexity;
        },
      });

      const errors = validate(schema, document, [complexityRule]);

      expect(errors).toHaveLength(0);
      // user (1) + id (1) + posts (1) + posts.id (1) = 4
      // name is skipped
      expect(calculatedComplexity).toBe(4);
    });

    it("should include fields with @skip(if: false)", () => {
      const query = `
        query {
          user(id: "1") {
            id
            name @skip(if: false)
          }
        }
      `;

      const document = parse(query);
      let calculatedComplexity = 0;

      const complexityRule = createQueryComplexityValidator({
        maximumComplexity: 100,
        estimators: [simpleEstimator({ defaultComplexity: 1 })],
        schema,
        onComplete: (complexity) => {
          calculatedComplexity = complexity;
        },
      });

      const errors = validate(schema, document, [complexityRule]);

      expect(errors).toHaveLength(0);
      // user (1) + id (1) + name (1) = 3
      expect(calculatedComplexity).toBe(3);
    });

    it("should handle @include directive", () => {
      const query = `
        query {
          user(id: "1") {
            id
            name @include(if: false)
          }
        }
      `;

      const document = parse(query);
      let calculatedComplexity = 0;

      const complexityRule = createQueryComplexityValidator({
        maximumComplexity: 100,
        estimators: [simpleEstimator({ defaultComplexity: 1 })],
        schema,
        onComplete: (complexity) => {
          calculatedComplexity = complexity;
        },
      });

      const errors = validate(schema, document, [complexityRule]);

      expect(errors).toHaveLength(0);
      // user (1) + id (1) = 2
      // name is not included
      expect(calculatedComplexity).toBe(2);
    });

    it("should handle directives with variables", () => {
      const query = `
        query GetUser($includeName: Boolean!) {
          user(id: "1") {
            id
            name @include(if: $includeName)
          }
        }
      `;

      const document = parse(query);
      let complexityWithName = 0;
      let complexityWithoutName = 0;

      // Test with includeName = true
      const rule1 = createQueryComplexityValidator({
        maximumComplexity: 100,
        estimators: [simpleEstimator({ defaultComplexity: 1 })],
        schema,
        variables: { includeName: true },
        onComplete: (complexity) => {
          complexityWithName = complexity;
        },
      });

      validate(schema, document, [rule1]);
      expect(complexityWithName).toBe(3); // user + id + name

      // Test with includeName = false
      const rule2 = createQueryComplexityValidator({
        maximumComplexity: 100,
        estimators: [simpleEstimator({ defaultComplexity: 1 })],
        schema,
        variables: { includeName: false },
        onComplete: (complexity) => {
          complexityWithoutName = complexity;
        },
      });

      validate(schema, document, [rule2]);
      expect(complexityWithoutName).toBe(2); // user + id
    });
  });

  describe("Fragment Handling", () => {
    it("should handle named fragments", () => {
      const query = `
        fragment UserFields on User {
          id
          name
        }

        query {
          user(id: "1") {
            ...UserFields
            posts {
              id
            }
          }
        }
      `;

      const document = parse(query);
      let calculatedComplexity = 0;

      const complexityRule = createQueryComplexityValidator({
        maximumComplexity: 100,
        estimators: [simpleEstimator({ defaultComplexity: 1 })],
        schema,
        onComplete: (complexity) => {
          calculatedComplexity = complexity;
        },
      });

      const errors = validate(schema, document, [complexityRule]);

      expect(errors).toHaveLength(0);
      // user (1) + id (1) + name (1) + posts (1) + posts.id (1) = 5
      expect(calculatedComplexity).toBe(5);
    });

    it("should handle inline fragments", () => {
      const query = `
        query {
          user(id: "1") {
            ... on User {
              id
              name
            }
          }
        }
      `;

      const document = parse(query);
      let calculatedComplexity = 0;

      const complexityRule = createQueryComplexityValidator({
        maximumComplexity: 100,
        estimators: [simpleEstimator({ defaultComplexity: 1 })],
        schema,
        onComplete: (complexity) => {
          calculatedComplexity = complexity;
        },
      });

      const errors = validate(schema, document, [complexityRule]);

      expect(errors).toHaveLength(0);
      // user (1) + id (1) + name (1) = 3
      expect(calculatedComplexity).toBe(3);
    });

    it("should handle nested fragments", () => {
      const query = `
        fragment PostFields on Post {
          id
          title
        }

        fragment UserWithPosts on User {
          id
          name
          posts {
            ...PostFields
          }
        }

        query {
          user(id: "1") {
            ...UserWithPosts
          }
        }
      `;

      const document = parse(query);
      let calculatedComplexity = 0;

      const complexityRule = createQueryComplexityValidator({
        maximumComplexity: 100,
        estimators: [simpleEstimator({ defaultComplexity: 1 })],
        schema,
        onComplete: (complexity) => {
          calculatedComplexity = complexity;
        },
      });

      const errors = validate(schema, document, [complexityRule]);

      expect(errors).toHaveLength(0);
      // user (1) + id (1) + name (1) + posts (1) + posts.id (1) + posts.title (1) = 6
      expect(calculatedComplexity).toBe(6);
    });
  });

  describe("Custom Estimators", () => {
    it("should use custom estimator based on arguments", () => {
      const query = `
        query {
          users(limit: 10) {
            id
            name
          }
        }
      `;

      const document = parse(query);
      let calculatedComplexity = 0;

      const customEstimator = ({ args, childComplexity }: any) => {
        if (args.limit !== undefined) {
          // Complexity = limit * (1 + child complexity)
          return args.limit * (1 + childComplexity);
        }
        return undefined;
      };

      const complexityRule = createQueryComplexityValidator({
        maximumComplexity: 1000,
        estimators: [customEstimator, simpleEstimator()],
        schema,
        onComplete: (complexity) => {
          calculatedComplexity = complexity;
        },
      });

      const errors = validate(schema, document, [complexityRule]);

      expect(errors).toHaveLength(0);
      // users: 10 * (1 + 2) = 30 (id + name = 2 child complexity)
      expect(calculatedComplexity).toBe(30);
    });

    it("should fall back to next estimator if current returns undefined", () => {
      const query = `
        query {
          user(id: "1") {
            id
          }
        }
      `;

      const document = parse(query);
      let calculatedComplexity = 0;

      const estimator1 = vi.fn(() => undefined);
      const estimator2 = vi.fn(({ childComplexity }) => 2 + childComplexity);

      const complexityRule = createQueryComplexityValidator({
        maximumComplexity: 100,
        estimators: [estimator1, estimator2],
        schema,
        onComplete: (complexity) => {
          calculatedComplexity = complexity;
        },
      });

      const errors = validate(schema, document, [complexityRule]);

      expect(errors).toHaveLength(0);
      expect(estimator1).toHaveBeenCalled();
      expect(estimator2).toHaveBeenCalled();
      // id: 2+0=2, user: 2+2=4 (includes id), total: 4
      expect(calculatedComplexity).toBe(4);
    });
  });

  describe("Node Limit (DoS Protection)", () => {
    it("should reject queries with too many nodes", () => {
      // Create a wide query instead of deep to avoid stack overflow
      // We need >10,000 nodes. Let's create a query with many aliases:
      // Each aliased field counts as a node
      let query = 'query { user(id: "1") {';
      // Add 5000 aliases of the id field (each is a separate node)
      for (let i = 0; i < 5000; i++) {
        query += ` id${i}: id`;
      }
      // Add 5000 aliases of the name field
      for (let i = 0; i < 5000; i++) {
        query += ` name${i}: name`;
      }
      query += " } }";

      const document = parse(query);

      const complexityRule = createQueryComplexityValidator({
        maximumComplexity: Number.MAX_SAFE_INTEGER, // Very high, we're testing node limit
        estimators: [simpleEstimator()],
        schema,
      });

      const errors = validate(schema, document, [complexityRule]);

      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toContain("exceeds maximum node limit");
    });
  });

  describe("Error Handling", () => {
    it("should throw error for invalid maximumComplexity", () => {
      expect(() => {
        createQueryComplexityValidator({
          maximumComplexity: -1,
          estimators: [simpleEstimator()],
          schema,
        });
      }).toThrow("Invalid maximumComplexity");
    });

    it("should throw error for empty estimators array", () => {
      expect(() => {
        createQueryComplexityValidator({
          maximumComplexity: 100,
          estimators: [],
          schema,
        });
      }).toThrow("At least one complexity estimator is required");
    });

    it("should invoke onComplete callback only when no errors", () => {
      const query = `
        query {
          user(id: "1") {
            id
          }
        }
      `;

      const document = parse(query);
      const onComplete = vi.fn();

      const complexityRule = createQueryComplexityValidator({
        maximumComplexity: 100,
        estimators: [simpleEstimator()],
        schema,
        onComplete,
      });

      validate(schema, document, [complexityRule]);

      expect(onComplete).toHaveBeenCalledWith(expect.any(Number));
    });

    it("should not invoke onComplete when query exceeds complexity", () => {
      const query = `
        query {
          users {
            id
            name
          }
        }
      `;

      const document = parse(query);
      const onComplete = vi.fn();

      const complexityRule = createQueryComplexityValidator({
        maximumComplexity: 1,
        estimators: [simpleEstimator()],
        schema,
        onComplete,
      });

      validate(schema, document, [complexityRule]);

      expect(onComplete).not.toHaveBeenCalled();
    });

    it("should handle all estimators returning undefined", () => {
      const query = `
        query {
          user(id: "1") {
            id
            name
          }
        }
      `;

      const document = parse(query);
      let calculatedComplexity = 0;

      const undefinedEstimator1 = vi.fn(() => undefined);
      const undefinedEstimator2 = vi.fn(() => undefined);

      const complexityRule = createQueryComplexityValidator({
        maximumComplexity: 100,
        estimators: [undefinedEstimator1, undefinedEstimator2],
        schema,
        onComplete: (complexity) => {
          calculatedComplexity = complexity;
        },
      });

      const errors = validate(schema, document, [complexityRule]);

      expect(errors).toHaveLength(0);
      expect(undefinedEstimator1).toHaveBeenCalled();
      expect(undefinedEstimator2).toHaveBeenCalled();
      // Should fall back to default: 1 + child complexity
      // user (1 + (id (1 + 0) + name (1 + 0))) = 1 + 2 = 3
      expect(calculatedComplexity).toBe(3);
    });
  });

  describe("Circular Fragment Protection", () => {
    it("should handle circular fragment references without infinite loop", () => {
      // This query has circular fragments but GraphQL validation will catch it
      // We test that our complexity calculator doesn't crash
      const query = `
        fragment UserFields on User {
          id
          friends {
            ...UserFields
          }
        }

        query {
          user(id: "1") {
            ...UserFields
          }
        }
      `;

      const document = parse(query);
      let calculatedComplexity = 0;

      const complexityRule = createQueryComplexityValidator({
        maximumComplexity: 1000,
        estimators: [simpleEstimator({ defaultComplexity: 1 })],
        schema,
        onComplete: (complexity) => {
          calculatedComplexity = complexity;
        },
      });

      // Should not crash or hang
      const errors = validate(schema, document, [complexityRule]);

      // Complexity should be calculated (fragment visited once per branch)
      expect(calculatedComplexity).toBeGreaterThan(0);
      expect(errors).toHaveLength(0);
    });

    it("should allow same fragment in parallel branches", () => {
      const query = `
        fragment UserBasic on User {
          id
          name
        }

        query {
          user(id: "1") {
            ...UserBasic
            posts {
              author {
                ...UserBasic
              }
            }
          }
        }
      `;

      const document = parse(query);
      let calculatedComplexity = 0;

      const complexityRule = createQueryComplexityValidator({
        maximumComplexity: 1000,
        estimators: [simpleEstimator({ defaultComplexity: 1 })],
        schema,
        onComplete: (complexity) => {
          calculatedComplexity = complexity;
        },
      });

      const errors = validate(schema, document, [complexityRule]);

      expect(errors).toHaveLength(0);
      // user (1) + id (1) + name (1) + posts (1) + author (1) + id (1) + name (1) = 7
      expect(calculatedComplexity).toBe(7);
    });
  });

  describe("fieldExtensionsEstimator", () => {
    it("should use complexity from field extensions", () => {
      const schemaWithExtensions = buildSchema(`
        directive @complexity(value: Int!) on FIELD_DEFINITION

        type Query {
          posts: [Post!]!
        }

        type Post {
          id: ID!
          title: String! @complexity(value: 5)
        }
      `);

      const query = `
        query {
          posts {
            id
            title
          }
        }
      `;

      const document = parse(query);
      let calculatedComplexity = 0;

      const complexityRule = createQueryComplexityValidator({
        maximumComplexity: 100,
        estimators: [fieldExtensionsEstimator(), simpleEstimator()],
        schema: schemaWithExtensions,
        onComplete: (complexity) => {
          calculatedComplexity = complexity;
        },
      });

      const errors = validate(schemaWithExtensions, document, [complexityRule]);

      expect(errors).toHaveLength(0);
      // posts (1) + id (1) + title (5) = 7
      expect(calculatedComplexity).toBe(7);
    });
  });
});
