/**
 * Apollo Server example with query complexity limiting.
 *
 * Uses the `didResolveOperation` plugin hook for accurate variable-aware
 * complexity calculation.
 *
 * Run:  pnpm example:apollo
 */

import { ApolloServer } from "@apollo/server";
import { startStandaloneServer } from "@apollo/server/standalone";
import { GraphQLError } from "graphql";
import { fieldExtensionsEstimator, getComplexity, simpleEstimator } from "../../src/index.js";
import { printBanner, resolvers, typeDefs } from "./schema.js";

const MAX_COMPLEXITY = 1000;

const server = new ApolloServer({
	plugins: [
		{
			async requestDidStart({ schema }) {
				return {
					async didResolveOperation({ document, request }) {
						const complexity = getComplexity({
							estimators: [fieldExtensionsEstimator(), simpleEstimator({ defaultComplexity: 1 })],
							query: document,
							schema,
							variables: request.variables ?? {},
						});

						console.log(`[complexity] ${complexity}`);

						if (complexity > MAX_COMPLEXITY) {
							throw new GraphQLError(
								`Query complexity ${complexity} exceeds maximum of ${MAX_COMPLEXITY}.`,
								{
									extensions: {
										code: "QUERY_TOO_COMPLEX",
										complexity,
										maximumComplexity: MAX_COMPLEXITY,
									},
								},
							);
						}
					},
				};
			},
		},
	],
	resolvers,
	typeDefs,
});

const PORT = 4000;
const { url } = await startStandaloneServer(server, { listen: { port: PORT } });
printBanner(PORT);
console.log(`Apollo Server ready at ${url}`);
