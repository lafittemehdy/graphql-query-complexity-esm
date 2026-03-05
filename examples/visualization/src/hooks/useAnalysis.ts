/**
 * Hook that runs complexity analysis on debounced query text.
 *
 * @module useAnalysis
 */

import { useMemo } from "react";
import { analyzeQuery } from "../lib/analysis-engine";
import { ANALYSIS_DEBOUNCE_MS } from "../lib/utils";
import type { AnalysisResult } from "../types/analysis";
import { useDebouncedValue } from "./useDebouncedValue";

/** Analyze `queryText` against `limit` using debounced text changes. */
export function useAnalysis(queryText: string, limit: number): AnalysisResult | null {
  const debouncedText = useDebouncedValue(queryText, ANALYSIS_DEBOUNCE_MS);

  return useMemo(() => {
    if (!debouncedText.trim()) return null;
    return analyzeQuery(debouncedText, limit);
  }, [debouncedText, limit]);
}
