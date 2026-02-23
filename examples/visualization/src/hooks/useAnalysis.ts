/**
 * Hook that runs complexity analysis on debounced query text.
 *
 * @module useAnalysis
 */

import { useMemo } from "react";
import { analyzeQuery } from "../lib/analysis-engine";
import type { AnalysisResult } from "../types/analysis";
import { useDebouncedValue } from "./useDebouncedValue";

/** Analyze `queryText` against `limit` with 250ms debounce on text changes. */
export function useAnalysis(queryText: string, limit: number): AnalysisResult | null {
  const debouncedText = useDebouncedValue(queryText, 250);

  return useMemo(() => {
    if (!debouncedText.trim()) return null;
    return analyzeQuery(debouncedText, limit);
  }, [debouncedText, limit]);
}
