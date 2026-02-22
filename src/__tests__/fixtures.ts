import { buildSchema, type GraphQLError, type GraphQLSchema, parse, validate } from "graphql";
import { complexityLimit } from "../complexity-rule.js";
import { simpleEstimator } from "../estimators.js";
import type { ComplexityEstimator } from "../types.js";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

/** Basic schema with users, posts, and comments for general tests. */
export const basicSchema = buildSchema(`
	type Query {
		comments(limit: Int): [Comment!]!
		post(id: ID!): Post
		posts(limit: Int, offset: Int): [Post!]!
		user(id: ID!): User
		users(limit: Int): [User!]!
	}

	type Mutation {
		createPost(title: String!, content: String!): Post!
		deleteUser(id: ID!): Boolean!
	}

	type Comment {
		author: User!
		id: ID!
		text: String!
	}

	type Post {
		author: User!
		comments(limit: Int): [Comment!]!
		content: String!
		id: ID!
		title: String!
	}

	type User {
		friends: [User!]!
		id: ID!
		name: String!
		posts(limit: Int): [Post!]!
	}
`);

/** Schema with the @complexity directive for directive-based tests. */
export const directiveSchema = buildSchema(`
	directive @complexity(value: Int!, multipliers: [String!]) on FIELD_DEFINITION

	type Query {
		posts: [Post!]! @complexity(value: 10)
		simple: String
		users(limit: Int): [User!]! @complexity(value: 2, multipliers: ["limit"])
	}

	type Post {
		id: ID!
		title: String! @complexity(value: 5)
	}

	type User {
		id: ID!
		name: String!
	}
`);

/** Schema with abstract types (interfaces and unions). */
export const abstractSchema = buildSchema(`
	interface SearchResult {
		relevance: Float!
	}

	type Post implements SearchResult {
		id: ID!
		relevance: Float!
		title: String!
	}

	type User implements SearchResult {
		id: ID!
		name: String!
		relevance: Float!
	}

	union Media = Post | User

	type Query {
		media: [Media!]!
		search(term: String!): [SearchResult!]!
	}
`);

/** Schema with multiple multiplier arguments. */
export const multiMultiplierSchema = buildSchema(`
	directive @complexity(value: Int!, multipliers: [String!]) on FIELD_DEFINITION

	type Query {
		items(limit: Int, take: Int): [Item!]! @complexity(value: 5, multipliers: ["limit", "take"])
	}

	type Item {
		id: ID!
	}
`);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Measure the maximum operation complexity in a query.
 *
 * Uses `Math.max` semantics to match {@link getComplexity}'s production
 * behavior of returning the highest complexity across operations.
 */
export function measureComplexity(
	schema: GraphQLSchema,
	query: string,
	options?: {
		estimators?: ComplexityEstimator[];
		maxComplexity?: number;
		variables?: Record<string, unknown>;
	},
): { complexity: number; errors: readonly GraphQLError[] } {
	let complexity = 0;
	const rule = complexityLimit(
		options?.maxComplexity ?? Number.MAX_SAFE_INTEGER,
		{
			estimators: options?.estimators ?? [simpleEstimator()],
			variables: options?.variables,
		},
		(complexities) => {
			complexity = Object.values(complexities).reduce((max, cost) => Math.max(max, cost), 0);
		},
	);
	const doc = parse(query);
	const errors = validate(schema, doc, [rule]);
	return { complexity, errors };
}
