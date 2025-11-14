import { buildSchema, parse, validate } from "graphql";
import { describe, expect, it, vi } from "vitest";
import {
  type ComplexityEstimator,
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
      let receivedArgs: Record<string, unknown> | null = null;

      const customEstimator = vi.fn(({ args, childComplexity }) => {
        if (typeof args.limit === "number") {
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
      let _receivedArgs: Record<string, unknown> | null = null;

      const customEstimator: ComplexityEstimator = ({
        args,
        childComplexity,
      }) => {
        if (typeof args.limit === "number") {
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

      const customEstimator: ComplexityEstimator = ({
        args,
        childComplexity,
      }) => {
        if (typeof args.limit === "number") {
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
    it("should reject queries with too many nodes using default limit", () => {
      // Create a wide query instead of deep to avoid stack overflow
      // We need >10,000 nodes. Let's create a query with many aliases:
      // Each aliased field counts as a node
      let query = 'query { user(id: "1") {';
      // Add 5001 aliases of the id field (each is a separate node)
      for (let i = 0; i < 5001; i++) {
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
      expect(errors[0].message).toContain(
        "exceeds maximum node limit of 10000",
      );
    });

    it("should reject queries exceeding custom maximumNodeCount", () => {
      const query = `
        query {
          user(id: "1") {
            id
            name
            posts {
              id
            }
          }
        }
      `; // This query has 5 nodes: user, id, name, posts, id

      const document = parse(query);

      const complexityRule = createQueryComplexityValidator({
        maximumComplexity: 100,
        maximumNodeCount: 4, // Set a custom low limit
        estimators: [simpleEstimator()],
        schema,
      });

      const errors = validate(schema, document, [complexityRule]);

      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain("exceeds maximum node limit of 4");
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

  describe("Abstract Type Handling", () => {
    it("should correctly calculate complexity for interfaces and unions", () => {
      const schemaWithAbstractTypes = buildSchema(`
        interface SearchResult {
          relevance: Float!
        }

        type Post implements SearchResult {
          relevance: Float!
          id: ID!
          title: String!
        }

        type User implements SearchResult {
          relevance: Float!
          id: ID!
          name: String!
        }
        
        union Media = Post | User

        type Query {
          search(term: String!): [SearchResult!]!
          media: [Media!]!
        }
      `);

      const query = `
        query {
          search(term: "graphql") {
            relevance
            ... on Post {
              id
              title
            }
            ... on User {
              name
            }
          }
          media {
            ... on Post {
              id
            }
          }
        }
      `;

      const document = parse(query);
      let calculatedComplexity = 0;

      const rule = createQueryComplexityValidator({
        maximumComplexity: 100,
        estimators: [simpleEstimator({ defaultComplexity: 1 })],
        schema: schemaWithAbstractTypes,
        onComplete: (c) => {
          calculatedComplexity = c;
        },
      });

      const errors = validate(schemaWithAbstractTypes, document, [rule]);
      expect(errors).toHaveLength(0);

      // search (1) + relevance (1) + id (1) + title (1) + name (1) = 5
      // media (1) + id (1) = 2
      // Total = 7
      expect(calculatedComplexity).toBe(7);
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
    const schemaWithDirectives = buildSchema(`
      directive @complexity(
        value: Int!,
        multipliers: [String!]
      ) on FIELD_DEFINITION

      type Query {
        # No directive, should fall back
        simple: String

        # Simple directive
        posts: [Post!]! @complexity(value: 10)

        # Directive with multiplier
        users(limit: Int): [User!]! @complexity(value: 2, multipliers: ["limit"])
        
        # Directive with multiple multipliers
        comments(limit: Int, take: Int): [Comment!]! @complexity(value: 5, multipliers: ["limit", "take"])
      }

      type User {
        id: ID!
        name: String!
      }

      type Post {
        id: ID!
        title: String! @complexity(value: 5)
      }

      type Comment {
        id: ID!
      }
    `);

    it("should use static complexity value from directive", () => {
      const query = `
        query {
          posts {
            id # Fallback to simpleEstimator (1)
            title # From directive (5)
          }
        }
      `;
      const document = parse(query);
      let calculatedComplexity = 0;

      const rule = createQueryComplexityValidator({
        maximumComplexity: 100,
        estimators: [
          fieldExtensionsEstimator(),
          simpleEstimator({ defaultComplexity: 1 }),
        ],
        schema: schemaWithDirectives,
        onComplete: (c) => {
          calculatedComplexity = c;
        },
      });

      const errors = validate(schemaWithDirectives, document, [rule]);
      expect(errors).toHaveLength(0);
      // posts (10) + childComplexity (id 1 + title 5) = 16
      expect(calculatedComplexity).toBe(16);
    });

    it("should use single multiplier", () => {
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

      const rule = createQueryComplexityValidator({
        maximumComplexity: 100,
        estimators: [
          fieldExtensionsEstimator(),
          simpleEstimator({ defaultComplexity: 1 }),
        ],
        schema: schemaWithDirectives,
        variables: { limit: 10 },
        onComplete: (c) => {
          calculatedComplexity = c;
        },
      });

      const errors = validate(schemaWithDirectives, document, [rule]);
      expect(errors).toHaveLength(0);
      // childComplexity = id (1) + name (1) = 2
      // users = value (2) + limit (10) * childComplexity (2) = 2 + 20 = 22
      expect(calculatedComplexity).toBe(22);
    });

    it("should use multiple multipliers", () => {
      const query = `
        query {
          comments(limit: 10, take: 5) {
            id
          }
        }
      `;
      const document = parse(query);
      let calculatedComplexity = 0;

      const rule = createQueryComplexityValidator({
        maximumComplexity: 1000,
        estimators: [
          fieldExtensionsEstimator(),
          simpleEstimator({ defaultComplexity: 1 }),
        ],
        schema: schemaWithDirectives,
        variables: { limit: 10, take: 5 },
        onComplete: (c) => {
          calculatedComplexity = c;
        },
      });

      const errors = validate(schemaWithDirectives, document, [rule]);
      expect(errors).toHaveLength(0);
      // childComplexity = id (1)
      // comments = value (5) + (limit * take) (10 * 5) * childComplexity (1) = 5 + 50 = 55
      expect(calculatedComplexity).toBe(55);
    });

    it("should ignore missing multiplier arguments", () => {
      const query = `
        query {
          users { # No limit provided
            id
          }
        }
      `;
      const document = parse(query);
      let calculatedComplexity = 0;

      const rule = createQueryComplexityValidator({
        maximumComplexity: 100,
        estimators: [
          fieldExtensionsEstimator(),
          simpleEstimator({ defaultComplexity: 1 }),
        ],
        schema: schemaWithDirectives,
        onComplete: (c) => {
          calculatedComplexity = c;
        },
      });

      const errors = validate(schemaWithDirectives, document, [rule]);
      expect(errors).toHaveLength(0);
      // childComplexity = id (1)
      // users = value (2) + multiplier (1) * childComplexity (1) = 3
      expect(calculatedComplexity).toBe(3);
    });

    it("should fall back to next estimator if directive is not present", () => {
      const query = `
        query {
          simple
        }
      `;
      const document = parse(query);
      let calculatedComplexity = 0;

      const rule = createQueryComplexityValidator({
        maximumComplexity: 100,
        estimators: [
          fieldExtensionsEstimator(),
          simpleEstimator({ defaultComplexity: 5 }), // Fallback
        ],
        schema: schemaWithDirectives,
        onComplete: (c) => {
          calculatedComplexity = c;
        },
      });

      const errors = validate(schemaWithDirectives, document, [rule]);
      expect(errors).toHaveLength(0);
      // simple field has no directive, so it uses the simpleEstimator
      expect(calculatedComplexity).toBe(5);
    });

    it("should use complexity from programmatic extensions object", () => {
      const schemaWithProgExt = buildSchema(`
        type Query {
          posts: [Post!]!
        }
        type Post {
          id: ID!
        }
      `);
      // @ts-expect-error - We are manually adding extensions for testing
      schemaWithProgExt.getQueryType().getFields().posts.extensions = {
        complexity: 20,
      };

      const query = `query { posts { id } }`;
      const document = parse(query);
      let calculatedComplexity = 0;

      const rule = createQueryComplexityValidator({
        maximumComplexity: 100,
        estimators: [
          fieldExtensionsEstimator(),
          simpleEstimator({ defaultComplexity: 1 }),
        ],
        schema: schemaWithProgExt,
        onComplete: (c) => {
          calculatedComplexity = c;
        },
      });

      const errors = validate(schemaWithProgExt, document, [rule]);
      expect(errors).toHaveLength(0);
      // posts (20) + childComplexity (id 1) = 21
      expect(calculatedComplexity).toBe(21);
    });
  });
});
