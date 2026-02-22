/**
 * GraphQL Yoga example with query complexity limiting.
 *
 * Uses the `onValidate` plugin to inject the complexity validation rule.
 *
 * Run:  pnpm example:yoga
 */

import { createServer } from "node:http";
import { makeExecutableSchema } from "@graphql-tools/schema";
import { createYoga } from "graphql-yoga";
import { complexityLimit, fieldExtensionsEstimator, simpleEstimator } from "../../src/index.js";
import { printBanner, resolvers, typeDefs } from "./schema.js";

const MAX_COMPLEXITY = 1000;

const schema = makeExecutableSchema({ typeDefs, resolvers });

const yoga = createYoga({
	plugins: [
		{
			onValidate({ addValidationRule, params }) {
				const variables = (params.variables as Record<string, unknown> | undefined) ?? {};

				addValidationRule(
					complexityLimit(
						MAX_COMPLEXITY,
						{
							estimators: [fieldExtensionsEstimator(), simpleEstimator({ defaultComplexity: 1 })],
							variables,
						},
						(complexities) => {
							const total = Object.values(complexities).reduce((sum, v) => sum + v, 0);
							console.log(`[complexity] ${total}`, complexities);
						},
					),
				);
			},
		},
	],
	schema,
});

const PORT = 4000;
const server = createServer(yoga);
server.listen(PORT, () => {
	printBanner(PORT);
	console.log("GraphQL Yoga ready");
});
