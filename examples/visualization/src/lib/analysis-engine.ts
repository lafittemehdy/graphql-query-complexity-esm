/**
 * Core complexity analysis engine for the visualization.
 *
 * Mirrors the real library's estimator chain and iterative post-order DFS
 * traversal from `src/complexity-engine.ts` and `src/estimators.ts`.
 *
 * @module analysis-engine
 */

import {
  buildSchema,
  type FieldNode,
  type FragmentDefinitionNode,
  type FragmentSpreadNode,
  type GraphQLField,
  type GraphQLNamedType,
  type GraphQLSchema,
  getNamedType,
  isCompositeType,
  isInterfaceType,
  isObjectType,
  Kind,
  parse,
  type SelectionNode,
  type ValueNode,
} from "graphql";

import type { AnalysisNode, AnalysisResult } from "../types/analysis";
import { COMPLEXITY_CONFIG, SCHEMA_SDL } from "./presets";

// ---------------------------------------------------------------------------
// Schema construction (cached)
// ---------------------------------------------------------------------------

let cachedSchema: GraphQLSchema | null = null;

/** Build and cache the demo schema with complexity extensions applied. */
function getSchema(): GraphQLSchema {
  if (cachedSchema) return cachedSchema;

  const schema = buildSchema(SCHEMA_SDL);

  for (const [key, config] of Object.entries(COMPLEXITY_CONFIG)) {
    const [typeName, fieldName] = key.split(".");
    if (!typeName || !fieldName) continue;

    const type = schema.getType(typeName);
    if (isObjectType(type) || isInterfaceType(type)) {
      const field = type.getFields()[fieldName];
      if (field) {
        field.extensions = { ...field.extensions, complexity: config };
      }
    }
  }

  cachedSchema = schema;
  return schema;
}

// ---------------------------------------------------------------------------
// Argument extraction
// ---------------------------------------------------------------------------

/** Extract argument values from a field's AST arguments. */
function extractArgs(fieldNode: FieldNode): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  if (!fieldNode.arguments) return args;

  for (const arg of fieldNode.arguments) {
    args[arg.name.value] = extractValueFromAst(arg.value);
  }
  return args;
}

/** Extract a JS value from a GraphQL AST value node. */
function extractValueFromAst(valueNode: ValueNode): unknown {
  switch (valueNode.kind) {
    case Kind.BOOLEAN:
      return valueNode.value;
    case Kind.ENUM:
      return valueNode.value;
    case Kind.FLOAT:
      return Number.parseFloat(valueNode.value);
    case Kind.INT:
      return Number.parseInt(valueNode.value, 10);
    case Kind.LIST:
      return valueNode.values.map(extractValueFromAst);
    case Kind.NULL:
      return null;
    case Kind.OBJECT: {
      const obj: Record<string, unknown> = {};
      for (const field of valueNode.fields) {
        obj[field.name.value] = extractValueFromAst(field.value);
      }
      return obj;
    }
    case Kind.STRING:
      return valueNode.value;
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// Cost calculation
// ---------------------------------------------------------------------------

/** Calculate field cost: `baseCost + multiplierProduct * childComplexity`. */
function calculateFieldCost(
  args: Record<string, unknown>,
  baseCost: number,
  childComplexity: number,
  multipliers: string[],
): { cost: number; multiplier: number } {
  let multiplier = 1;
  for (const name of multipliers) {
    const argValue = args[name];
    if (typeof argValue === "number" && Number.isFinite(argValue)) {
      multiplier *= argValue;
    }
  }
  return {
    cost: baseCost + multiplier * childComplexity,
    multiplier,
  };
}

// ---------------------------------------------------------------------------
// Estimator chain
// ---------------------------------------------------------------------------

interface EstimatorResult {
  baseCost: number;
  cost: number;
  estimatorUsed: "fieldExtensions" | "simple";
  multiplier: number;
  multiplierArgs: string[];
}

/**
 * Run the estimator chain for a field.
 *
 * 1. Check `field.extensions.complexity` (number or config object)
 * 2. Fall back to simple estimator (base cost 1 + childComplexity)
 */
function runEstimators(
  fieldDef: GraphQLField<unknown, unknown>,
  args: Record<string, unknown>,
  childComplexity: number,
): EstimatorResult {
  const ext = (fieldDef.extensions as Record<string, unknown> | undefined)?.complexity;

  // fieldExtensionsEstimator: flat number
  if (typeof ext === "number" && Number.isFinite(ext)) {
    return {
      baseCost: ext,
      cost: Math.max(0, ext + childComplexity),
      estimatorUsed: "fieldExtensions",
      multiplier: 1,
      multiplierArgs: [],
    };
  }

  // fieldExtensionsEstimator: config object with multipliers
  if (ext && typeof ext === "object") {
    const config = ext as { multipliers?: string[]; value: number };
    if (typeof config.value === "number") {
      const multipliers = Array.isArray(config.multipliers) ? config.multipliers : [];
      const result = calculateFieldCost(args, config.value, childComplexity, multipliers);
      return {
        baseCost: config.value,
        cost: Math.max(0, result.cost),
        estimatorUsed: "fieldExtensions",
        multiplier: result.multiplier,
        multiplierArgs: multipliers,
      };
    }
  }

  // simpleEstimator fallback (base cost 1)
  return {
    baseCost: 1,
    cost: Math.max(0, 1 + childComplexity),
    estimatorUsed: "simple",
    multiplier: 1,
    multiplierArgs: [],
  };
}

// ---------------------------------------------------------------------------
// Main analysis (iterative post-order DFS producing a tree)
// ---------------------------------------------------------------------------

let nodeCounter = 0;

/** Analyze a GraphQL query and produce a cost tree. */
export function analyzeQuery(queryString: string, limit: number): AnalysisResult {
  nodeCounter = 0;

  try {
    const document = parse(queryString);
    const schema = getSchema();
    const queryType = schema.getQueryType();

    if (!queryType) {
      return { complexity: 0, error: "No Query type in schema", limit, nodes: [], passed: true };
    }

    const fragments: Record<string, FragmentDefinitionNode> = {};
    for (const def of document.definitions) {
      if (def.kind === Kind.FRAGMENT_DEFINITION) {
        fragments[def.name.value] = def;
      }
    }

    const operation = document.definitions.find((def) => def.kind === Kind.OPERATION_DEFINITION);

    if (!operation || !("selectionSet" in operation) || !operation.selectionSet) {
      return { complexity: 0, error: "No operation found", limit, nodes: [], passed: true };
    }

    const nodes = processSelectionSet(
      operation.selectionSet.selections,
      queryType,
      schema,
      fragments,
      new Set(),
      0,
    );

    const complexity = nodes.reduce((sum, node) => sum + node.totalCost, 0);

    return {
      complexity,
      error: null,
      limit,
      nodes,
      passed: complexity <= limit,
    };
  } catch (err) {
    return {
      complexity: 0,
      error: err instanceof Error ? err.message : "Parse error",
      limit,
      nodes: [],
      passed: true,
    };
  }
}

// ---------------------------------------------------------------------------
// Selection set processing
// ---------------------------------------------------------------------------

/** Process a selection set and return an array of AnalysisNode objects. */
function processSelectionSet(
  selections: readonly SelectionNode[],
  parentType: GraphQLNamedType,
  schema: GraphQLSchema,
  fragments: Record<string, FragmentDefinitionNode>,
  visitedFragments: Set<string>,
  depth: number,
): AnalysisNode[] {
  const results: AnalysisNode[] = [];

  for (const selection of selections) {
    switch (selection.kind) {
      case Kind.FIELD: {
        const node = processField(
          selection,
          parentType,
          schema,
          fragments,
          visitedFragments,
          depth,
        );
        if (node) results.push(node);
        break;
      }
      case Kind.FRAGMENT_SPREAD: {
        const spreadNodes = processFragmentSpread(
          selection,
          parentType,
          schema,
          fragments,
          visitedFragments,
          depth,
        );
        results.push(...spreadNodes);
        break;
      }
      case Kind.INLINE_FRAGMENT: {
        const inlineType = selection.typeCondition
          ? schema.getType(selection.typeCondition.name.value)
          : parentType;
        if (selection.selectionSet && inlineType) {
          const inlineNodes = processSelectionSet(
            selection.selectionSet.selections,
            inlineType,
            schema,
            fragments,
            visitedFragments,
            depth,
          );
          results.push(...inlineNodes);
        }
        break;
      }
    }
  }

  return results;
}

/** Process a single field selection node. */
function processField(
  fieldNode: FieldNode,
  parentType: GraphQLNamedType,
  schema: GraphQLSchema,
  fragments: Record<string, FragmentDefinitionNode>,
  visitedFragments: Set<string>,
  depth: number,
): AnalysisNode | null {
  if (!isObjectType(parentType) && !isInterfaceType(parentType)) return null;

  const fieldName = fieldNode.name.value;
  const fieldDef = parentType.getFields()[fieldName];
  if (!fieldDef) return null;

  const args = extractArgs(fieldNode);
  const returnType = getNamedType(fieldDef.type);
  const returnTypeStr = fieldDef.type.toString();
  const id = `field-${nodeCounter++}`;
  const startLine = fieldNode.loc?.startToken?.line ?? 0;

  let children: AnalysisNode[] = [];
  let childComplexity = 0;

  if (fieldNode.selectionSet && returnType && isCompositeType(returnType)) {
    children = processSelectionSet(
      fieldNode.selectionSet.selections,
      returnType,
      schema,
      fragments,
      visitedFragments,
      depth + 1,
    );
    childComplexity = children.reduce((sum, child) => sum + child.totalCost, 0);
  }

  const estimation = runEstimators(fieldDef, args, childComplexity);

  let category: AnalysisNode["category"] = "leaf";
  if (depth === 0 && fieldNode.selectionSet) {
    category = "root";
  } else if (estimation.multiplier > 1) {
    category = "multiplied";
  } else if (fieldNode.selectionSet) {
    category = "composite";
  }

  return {
    args,
    baseCost: estimation.baseCost,
    category,
    childComplexity,
    children,
    depth,
    estimatorUsed: estimation.estimatorUsed,
    fieldName,
    id,
    multiplier: estimation.multiplier,
    multiplierArgs: estimation.multiplierArgs,
    parentType: parentType.name,
    returnType: returnTypeStr,
    startLine,
    totalCost: estimation.cost,
  };
}

/** Process a fragment spread, returning expanded field nodes. */
function processFragmentSpread(
  spreadNode: FragmentSpreadNode,
  parentType: GraphQLNamedType,
  schema: GraphQLSchema,
  fragments: Record<string, FragmentDefinitionNode>,
  visitedFragments: Set<string>,
  depth: number,
): AnalysisNode[] {
  const fragmentName = spreadNode.name.value;

  if (visitedFragments.has(fragmentName)) return [];

  const fragment = fragments[fragmentName];
  if (!fragment) return [];

  const fragmentType = schema.getType(fragment.typeCondition.name.value) ?? parentType;

  const visited = new Set(visitedFragments);
  visited.add(fragmentName);

  return processSelectionSet(
    fragment.selectionSet.selections,
    fragmentType,
    schema,
    fragments,
    visited,
    depth,
  );
}

// ---------------------------------------------------------------------------
// Tree flattening
// ---------------------------------------------------------------------------

/** Flatten the analysis tree into a pre-order array. */
export function flattenNodes(nodes: AnalysisNode[]): AnalysisNode[] {
  const result: AnalysisNode[] = [];

  function walk(nodeList: AnalysisNode[]): void {
    for (const node of nodeList) {
      result.push(node);
      if (node.children.length > 0) {
        walk(node.children);
      }
    }
  }

  walk(nodes);
  return result;
}
