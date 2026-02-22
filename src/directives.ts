import {
	type DirectiveNode,
	type GraphQLDirective,
	GraphQLIncludeDirective,
	GraphQLSkipDirective,
	getDirectiveValues,
} from "graphql";

/**
 * SDL definition for the `@complexity` directive.
 *
 * Add this to your schema when using the `fieldExtensionsEstimator` with
 * directive-based costs.
 *
 * - `value`       — Base complexity cost for the field.
 * - `multipliers` — Argument names whose runtime values multiply child
 *                   complexity (e.g. pagination `limit`).
 *
 * @example
 * ```graphql
 * directive @complexity(value: Int!, multipliers: [String!]) on FIELD_DEFINITION
 *
 * type Query {
 *   users(limit: Int): [User!]! @complexity(value: 2, multipliers: ["limit"])
 * }
 * ```
 */
export const complexityDirectiveTypeDefs = /* GraphQL */ `directive @complexity(value: Int!, multipliers: [String!]) on FIELD_DEFINITION`;

function getDirectiveValuesSafe(
	directive: GraphQLDirective,
	node: { readonly directives?: ReadonlyArray<DirectiveNode> },
	variables: Record<string, unknown>,
) {
	try {
		return getDirectiveValues(directive, node, variables);
	} catch {
		// Runtime variable coercion can fail for directive arguments.
		// Let execution/validation layers report that error; complexity traversal
		// should keep running deterministically.
		return undefined;
	}
}

/**
 * Determine whether a node should be excluded from complexity calculation
 * based on `@skip` and `@include` directives.
 *
 * @internal
 */
export function shouldSkipNode(
	node: { readonly directives?: ReadonlyArray<DirectiveNode> },
	variables: Record<string, unknown>,
): boolean {
	const skip = getDirectiveValuesSafe(GraphQLSkipDirective, node, variables);
	if (skip?.if === true) return true;

	const include = getDirectiveValuesSafe(GraphQLIncludeDirective, node, variables);
	if (include?.if === false) return true;

	return false;
}
