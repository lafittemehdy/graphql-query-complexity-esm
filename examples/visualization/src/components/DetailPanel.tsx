/**
 * Detail panel — slides in when a field is selected, showing cost breakdown.
 *
 * @module DetailPanel
 */

import { useMemo } from "react";
import { flattenNodes } from "../lib/analysis-engine";
import { costColor, formatNumber } from "../lib/utils";
import type { AnalysisNode, AnalysisResult } from "../types/analysis";

interface DetailPanelProps {
  onClose: () => void;
  onNavigate: (nodeId: string) => void;
  result: AnalysisResult | null;
  selectedNodeId: string | null;
}

/** Sliding detail panel with cost formula, breakdown, and navigation. */
export function DetailPanel({ onClose, onNavigate, result, selectedNodeId }: DetailPanelProps) {
  const flatNodes = useMemo(() => (result?.nodes ? flattenNodes(result.nodes) : []), [result]);

  const selectedNode = useMemo(
    () => flatNodes.find((n) => n.id === selectedNodeId) ?? null,
    [flatNodes, selectedNodeId],
  );

  const totalCost = result?.complexity ?? 0;
  const isVisible = selectedNode !== null;

  const parentNode = useMemo(
    () => flatNodes.find((n) => n.children.some((c) => c.id === selectedNodeId)) ?? null,
    [flatNodes, selectedNodeId],
  );

  return (
    <div className={`detail-panel${isVisible ? " visible" : ""}`}>
      {selectedNode && (
        <>
          <button className="detail-close" onClick={onClose} title="Close (Esc)" type="button">
            &times;
          </button>

          <DetailHeader node={selectedNode} />
          <DetailRow label="Returns" value={selectedNode.returnType} />
          <DetailRow
            label="Estimator"
            value={
              selectedNode.estimatorUsed === "fieldExtensions"
                ? "fieldExtensionsEstimator"
                : "simpleEstimator"
            }
            valueClass="detail-estimator"
          />
          <FormulaSection node={selectedNode} />
          {selectedNode.multiplier > 1 && <MultiplierSection node={selectedNode} />}
          <CostShareSection node={selectedNode} totalCost={totalCost} />
          {Object.keys(selectedNode.args).length > 0 && <ArgumentsSection node={selectedNode} />}
          {parentNode && <ParentLink node={parentNode} onNavigate={onNavigate} />}
          {selectedNode.children.length > 0 && (
            <ChildrenSection
              childNodes={selectedNode.children}
              onNavigate={onNavigate}
              totalCost={totalCost}
            />
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function DetailHeader({ node }: { node: AnalysisNode }) {
  return (
    <div className="detail-header">
      <span className="detail-type-label">{node.parentType}</span>
      <span className="detail-field-name">.{node.fieldName}</span>
      <span className={`detail-category detail-category-${node.category}`}>{node.category}</span>
    </div>
  );
}

function DetailRow({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="detail-row">
      <span className="detail-label">{label}</span>
      <span className={`detail-value${valueClass ? ` ${valueClass}` : ""}`}>{value}</span>
    </div>
  );
}

function FormulaSection({ node }: { node: AnalysisNode }) {
  return (
    <div className="detail-section">
      <div className="detail-section-title">Cost Formula</div>
      <div className="detail-formula">
        <FormulaCard node={node} />
      </div>
    </div>
  );
}

function FormulaCard({ node }: { node: AnalysisNode }) {
  if (node.children.length === 0) {
    return (
      <div className="formula-card formula-card-leaf">
        <span className="formula-value formula-value-total">{node.baseCost}</span>
        <span className="formula-caption">base cost</span>
      </div>
    );
  }

  if (node.multiplier > 1) {
    return (
      <div className="formula-card formula-card-multiplied">
        <div className="formula-equation">
          <div className="formula-operand">
            <span className="formula-value formula-value-base">{node.baseCost}</span>
            <span className="formula-caption">base</span>
          </div>
          <span className="formula-operator">+</span>
          <div className="formula-operand formula-operand-highlight">
            <span className="formula-value formula-value-multiplier">{node.multiplier}</span>
            <span className="formula-caption">multiplier</span>
          </div>
          <span className="formula-operator">&times;</span>
          <div className="formula-operand">
            <span className="formula-value formula-value-children">
              {formatNumber(node.childComplexity)}
            </span>
            <span className="formula-caption">children</span>
          </div>
        </div>
        <div className="formula-result-divider" />
        <div className="formula-result">
          <span className="formula-value formula-value-total">{formatNumber(node.totalCost)}</span>
          <span className="formula-caption">total cost</span>
        </div>
      </div>
    );
  }

  return (
    <div className="formula-card formula-card-composite">
      <div className="formula-equation">
        <div className="formula-operand">
          <span className="formula-value formula-value-base">{node.baseCost}</span>
          <span className="formula-caption">base</span>
        </div>
        <span className="formula-operator">+</span>
        <div className="formula-operand">
          <span className="formula-value formula-value-children">
            {formatNumber(node.childComplexity)}
          </span>
          <span className="formula-caption">children</span>
        </div>
      </div>
      <div className="formula-result-divider" />
      <div className="formula-result">
        <span className="formula-value formula-value-total">{formatNumber(node.totalCost)}</span>
        <span className="formula-caption">total cost</span>
      </div>
    </div>
  );
}

function MultiplierSection({ node }: { node: AnalysisNode }) {
  return (
    <div className="detail-section">
      <div className="detail-section-title">Multiplier Source</div>
      {node.multiplierArgs.map((argName) => {
        const argValue = node.args[argName];
        if (argValue === undefined) return null;
        return (
          <div className="detail-multiplier-row" key={argName}>
            <span className="detail-arg-name">{argName}</span>
            <span className="detail-arg-equals">=</span>
            <span className="detail-arg-value">{String(argValue)}</span>
          </div>
        );
      })}
    </div>
  );
}

function CostShareSection({ node, totalCost }: { node: AnalysisNode; totalCost: number }) {
  const percent = totalCost > 0 ? (node.totalCost / totalCost) * 100 : 0;
  const color = costColor(node.totalCost, totalCost);

  return (
    <div className="detail-section">
      <div className="detail-section-title">Cost Share</div>
      <div className="detail-share-bar">
        <div
          className="detail-share-fill"
          style={{ backgroundColor: color, width: `${Math.min(percent, 100)}%` }}
        />
      </div>
      <div className="detail-share-text">
        <strong>{formatNumber(node.totalCost)}</strong> / {formatNumber(totalCost)}{" "}
        <span className="detail-share-percent">({percent.toFixed(1)}%)</span>
      </div>
    </div>
  );
}

function ArgumentsSection({ node }: { node: AnalysisNode }) {
  return (
    <div className="detail-section">
      <div className="detail-section-title">Arguments</div>
      {Object.entries(node.args).map(([name, value]) => (
        <div className="detail-arg-row" key={name}>
          <span className="detail-arg-name">{name}</span>:{" "}
          <span className="detail-arg-value">{JSON.stringify(value)}</span>
        </div>
      ))}
    </div>
  );
}

function ParentLink({
  node,
  onNavigate,
}: {
  node: AnalysisNode;
  onNavigate: (id: string) => void;
}) {
  return (
    <div className="detail-section">
      <button
        className="detail-nav-link"
        onClick={() => onNavigate(node.id)}
        title="Navigate to parent field"
        type="button"
      >
        &larr; {node.parentType}.{node.fieldName}
      </button>
    </div>
  );
}

function ChildrenSection({
  childNodes,
  onNavigate,
  totalCost,
}: {
  childNodes: AnalysisNode[];
  onNavigate: (id: string) => void;
  totalCost: number;
}) {
  return (
    <div className="detail-section">
      <div className="detail-section-title">Children ({childNodes.length})</div>
      <div className="detail-child-list">
        {childNodes.map((child) => (
          <button
            className="detail-child-btn"
            key={child.id}
            onClick={() => onNavigate(child.id)}
            type="button"
          >
            <span className="detail-child-name">{child.fieldName}</span>
            <span
              className="detail-child-cost"
              style={{ color: costColor(child.totalCost, totalCost) }}
            >
              {formatNumber(child.totalCost)}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
