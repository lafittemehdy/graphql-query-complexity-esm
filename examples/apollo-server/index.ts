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
