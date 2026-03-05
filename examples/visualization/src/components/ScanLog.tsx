/**
 * Scan Log — right-panel cost audit trail during the intro animation.
 *
 * Renders one row per editor line so entries align horizontally with their
 * corresponding code. Lines with a node show the field name, multiplier
 * badge, and cost contribution. Lines without a node are empty spacers.
 *
 * @module ScanLog
 */

import { useMemo } from "react";
import { costColor, formatNumber } from "../lib/utils";
import type { AnalysisNode } from "../types/analysis";

interface ScanLogProps {
  complete?: boolean;
  costSteps: number[];
  flatNodes: AnalysisNode[];
  onExplore: () => void;
  scanIndex: number;
  totalLines: number;
}

/** Line-aligned audit trail showing cost building up field by field. */
export function ScanLog({
  complete,
  costSteps,
  flatNodes,
  onExplore,
  scanIndex,
  totalLines,
}: ScanLogProps) {
  /** Map line number → { node, flatIndex } for O(1) lookups. */
  const lineMap = useMemo(() => {
    const map = new Map<number, { flatIndex: number; node: AnalysisNode }>();
    for (let i = 0; i < flatNodes.length; i++) {
      const node = flatNodes[i]!;
      if (node.startLine > 0) {
        map.set(node.startLine, { flatIndex: i, node });
      }
    }
    return map;
  }, [flatNodes]);

  /** Per-node cost contribution (increment from previous step). */
  const contributions = useMemo(
    () =>
      costSteps.map((step, i) => {
        const prev = i > 0 ? (costSteps[i - 1] ?? 0) : 0;
        return step - prev;
      }),
    [costSteps],
  );

  const runningTotal = scanIndex >= 0 ? (costSteps[scanIndex] ?? 0) : 0;
  const totalCost = costSteps.length > 0 ? (costSteps[costSteps.length - 1] ?? 0) : 0;

  /** Build line rows (1-indexed to match editor). */
  const rows = useMemo(() => {
    const result: React.ReactNode[] = [];
    for (let lineNum = 1; lineNum <= totalLines; lineNum++) {
      const entry = lineMap.get(lineNum);
      if (entry) {
        const { flatIndex, node } = entry;
        const contribution = contributions[flatIndex] ?? 0;
        const isVisible = flatIndex <= scanIndex;
        const isActive = flatIndex === scanIndex;
        const color = isVisible ? costColor(contribution, totalCost) : undefined;

        result.push(
          <div
            className={`scan-log-row scan-log-has-node${isVisible ? " visible" : ""}${isActive ? " active" : ""}`}
            key={lineNum}
          >
            <span className="scan-log-name">{node.fieldName}</span>
            {node.multiplier > 1 && (
              <span className="scan-log-multiplier">
                {"\u00d7"}
                {node.multiplier}
              </span>
            )}
            <span className="scan-log-cost" style={color ? { color } : undefined}>
              {isVisible ? `+${formatNumber(contribution)}` : ""}
            </span>
          </div>,
        );
      } else {
        result.push(<div className="scan-log-row" key={lineNum} />);
      }
    }
    return result;
  }, [contributions, lineMap, scanIndex, totalCost, totalLines]);

  return (
    <div className="scan-log">
      <div className="scan-log-rows">{rows}</div>

      <div className={`scan-log-footer${scanIndex >= 0 ? " visible" : ""}`}>
        <output aria-live="polite" className="scan-log-footer-top">
          <span className="scan-log-total-label">Total</span>
          <span className="scan-log-total-value">{formatNumber(runningTotal)}</span>
        </output>
        <button
          className={`scan-log-cta${complete ? " visible" : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            onExplore();
          }}
          type="button"
        >
          explore this query{" "}
          <span aria-hidden="true" className="scan-log-cta-arrow">
            &rarr;
          </span>
        </button>
      </div>
    </div>
  );
}
