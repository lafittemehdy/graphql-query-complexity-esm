/**
 * Shared schema, mock data, and resolvers for example servers.
 *
 * Demonstrates the @complexity directive with multipliers for accurate
 * cost estimation on paginated fields.
 */

import { complexityDirectiveTypeDefs } from "../../src/index.js";

// ---------------------------------------------------------------------------
// Type definitions
// ---------------------------------------------------------------------------

export const typeDefs = `#graphql
	${complexityDirectiveTypeDefs}

	type Query {
		post(id: ID!): Post
		posts(limit: Int): [Post!]! @complexity(value: 1, multipliers: ["limit"])
		user(id: ID!): User
		users(limit: Int): [User!]! @complexity(value: 2, multipliers: ["limit"])
	}

	type Comment {
		author: User!
		id: ID!
		text: String!
	}

	type Post {
		author: User!
		comments(limit: Int): [Comment!]! @complexity(value: 1, multipliers: ["limit"])
		content: String!
		id: ID!
		title: String!
	}

	type User {
		friends: [User!]! @complexity(value: 3)
		id: ID!
		name: String!
		posts(limit: Int): [Post!]! @complexity(value: 1, multipliers: ["limit"])
	}
`;

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

interface MockUser {
	friendIds: string[];
	id: string;
	name: string;
}

interface MockPost {
	authorId: string;
	content: string;
	id: string;
	title: string;
}

interface MockComment {
	authorId: string;
	id: string;
	postId: string;
	text: string;
}

const users: MockUser[] = [
	{ friendIds: ["2", "3"], id: "1", name: "Alice" },
	{ friendIds: ["1"], id: "2", name: "Bob" },
	{ friendIds: ["1", "2"], id: "3", name: "Charlie" },
];

const posts: MockPost[] = [
	{ authorId: "1", content: "GraphQL is great!", id: "p1", title: "Hello GraphQL" },
	{ authorId: "2", content: "Protect your APIs.", id: "p2", title: "Query Complexity" },
];

const comments: MockComment[] = [
	{ authorId: "2", id: "c1", postId: "p1", text: "Great post!" },
	{ authorId: "3", id: "c2", postId: "p1", text: "Very helpful." },
	{ authorId: "1", id: "c3", postId: "p2", text: "Thanks for sharing." },
];

// ---------------------------------------------------------------------------
// Resolvers
// ---------------------------------------------------------------------------

export const resolvers = {
	Comment: {
		author: (comment: MockComment) => users.find((u) => u.id === comment.authorId),
	},
	Post: {
		author: (post: MockPost) => users.find((u) => u.id === post.authorId),
		comments: (post: MockPost, args: { limit?: number }) => {
			const matched = comments.filter((c) => c.postId === post.id);
			return args.limit ? matched.slice(0, args.limit) : matched;
		},
	},
	Query: {
		post: (_: unknown, args: { id: string }) => posts.find((p) => p.id === args.id),
		posts: (_: unknown, args: { limit?: number }) =>
			args.limit ? posts.slice(0, args.limit) : posts,
		user: (_: unknown, args: { id: string }) => users.find((u) => u.id === args.id),
		users: (_: unknown, args: { limit?: number }) =>
			args.limit ? users.slice(0, args.limit) : users,
	},
	User: {
		friends: (user: MockUser) => user.friendIds.map((id) => users.find((u) => u.id === id)),
		posts: (user: MockUser, args: { limit?: number }) => {
			const matched = posts.filter((p) => p.authorId === user.id);
			return args.limit ? matched.slice(0, args.limit) : matched;
		},
	},
};

// ---------------------------------------------------------------------------
// Banner
// ---------------------------------------------------------------------------

export function printBanner(port: number): void {
	console.log(`
┌─────────────────────────────────────────────┐
│  graphql-query-complexity-esm  —  Example   │
├─────────────────────────────────────────────┤
│  Server:   http://localhost:${port}/graphql    │
│  Max:      1000 complexity                  │
│  Engine:   iterative (stack-based DFS)      │
└─────────────────────────────────────────────┘

Try these queries:

  # Safe query (low complexity)
  query Safe {
    users(limit: 3) { id name }
  }

  # Medium query (moderate complexity)
  query Medium {
    users(limit: 10) {
      id name
      posts(limit: 5) { title }
    }
  }

  # Expensive query (may exceed limit)
  query Expensive {
    users(limit: 100) {
      id name
      posts(limit: 50) {
        title
        comments(limit: 20) { text }
      }
    }
  }
`);
}
