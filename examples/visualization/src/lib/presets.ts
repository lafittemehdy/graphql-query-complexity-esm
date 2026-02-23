/**
 * Schema SDL, complexity configuration, and preset queries.
 *
 * @module presets
 */

import type { Preset } from "../types/analysis";

// ---------------------------------------------------------------------------
// Schema SDL
// ---------------------------------------------------------------------------

/** Demo GraphQL schema used throughout the visualization. */
export const SCHEMA_SDL = `
  type Comment {
    author: User!
    createdAt: String
    likes: Int
    text: String!
  }

  type Post {
    body: String
    comments(first: Int): [Comment!]!
    id: ID!
    publishedAt: String
    tags: [String!]
    title: String!
  }

  type Query {
    user(id: ID!): User
    users(first: Int, last: Int): [User!]!
  }

  type User {
    avatar: String
    createdAt: String
    email: String!
    followers(first: Int, last: Int): [User!]!
    id: ID!
    name: String!
    posts(first: Int, last: Int): [Post!]!
    role: String
  }
`;

/**
 * Field extensions complexity configuration for the demo schema.
 * Maps `TypeName.fieldName` to its complexity config.
 */
export const COMPLEXITY_CONFIG: Record<string, { multipliers?: string[]; value: number }> = {
  "Post.comments": { multipliers: ["first"], value: 1 },
  "Query.users": { multipliers: ["first", "last"], value: 1 },
  "User.followers": { multipliers: ["first", "last"], value: 1 },
  "User.posts": { multipliers: ["first", "last"], value: 1 },
};

// ---------------------------------------------------------------------------
// Preset queries (alphabetical by id)
// ---------------------------------------------------------------------------

/** Ordered list of preset queries. */
export const PRESETS: Preset[] = [
  {
    description: "Flat query, base cost per field",
    expectedCost: 3,
    id: "simple",
    label: "Simple",
    limit: 10,
    query: `query GetUser {
  user(id: "1") {
    name
    email
  }
}`,
  },
  {
    description: "Pagination multiplier on a list field",
    expectedCost: 31,
    id: "list",
    label: "List",
    limit: 50,
    query: `query UserList {
  users(first: 10) {
    id
    name
    email
  }
}`,
  },
  {
    description: "Multipliers compound through nesting",
    expectedCost: 271,
    id: "nested",
    label: "Nested",
    limit: 300,
    query: `query Nested {
  users(first: 10) {
    name
    posts(first: 5) {
      title
      comments(first: 3) {
        text
      }
    }
  }
}`,
  },
  {
    description: "Why you need this library",
    expectedCost: 32701,
    id: "bomb",
    label: "Exponential",
    limit: 500,
    query: `query DashboardData {
  users(first: 50) {
    name
    email
    posts(first: 20) {
      title
      comments(first: 10) {
        text
        author {
          name
        }
      }
    }
    followers(first: 10) {
      name
    }
  }
}`,
  },
  {
    description: "Named fragment expansion",
    expectedCost: 9,
    id: "fragment",
    label: "Fragment",
    limit: 15,
    query: `query WithFragment {
  user(id: "1") {
    ...UserFields
  }
}

fragment UserFields on User {
  name
  email
  posts(first: 5) {
    title
  }
}`,
  },
  {
    description: "Adjust the limit to see BLOCKED \u2192 PASS",
    expectedCost: 26,
    id: "tuned",
    label: "Tuned",
    limit: 20,
    query: `query AdjustedLimit {
  users(first: 5) {
    name
    posts(first: 3) {
      title
    }
  }
}`,
  },
];

/** Default preset loaded on first visit. */
export const DEFAULT_PRESET_ID = "bomb";
