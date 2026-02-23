/** A single field node in the analysis tree. */
export interface AnalysisNode {
  args: Record<string, unknown>;
  baseCost: number;
  category: "composite" | "leaf" | "multiplied" | "root";
  childComplexity: number;
  children: AnalysisNode[];
  depth: number;
  estimatorUsed: "fieldExtensions" | "simple";
  fieldName: string;
  id: string;
  multiplier: number;
  multiplierArgs: string[];
  parentType: string;
  returnType: string;
  startLine: number;
  totalCost: number;
}

/** Result of analyzing a complete query. */
export interface AnalysisResult {
  complexity: number;
  error: string | null;
  limit: number;
  nodes: AnalysisNode[];
  passed: boolean;
}

/** A preset query configuration. */
export interface Preset {
  description: string;
  expectedCost: number;
  id: string;
  label: string;
  limit: number;
  query: string;
}
