/**
 * Overlay Code Editor — transparent textarea over a highlighted `<pre>`
 * backdrop with line numbers and a cost gutter.
 *
 * Supports a "scan" mode where lines dim/light up sequentially during
 * the intro animation.
 *
 * @module CodeEditor
 */

import { useCallback, useMemo, useRef } from "react";
import { flattenNodes } from "../lib/analysis-engine";
import { costColor, escapeHtml, escapeRegex, formatNumber } from "../lib/utils";
import type { AnalysisNode, AnalysisResult } from "../types/analysis";

interface CodeEditorProps {
  dimmed?: boolean;
  disabled?: boolean;
  onFieldSelect: (nodeId: string | null) => void;
  onQueryChange: (text: string) => void;
  queryText: string;
  result: AnalysisResult | null;
  scanningNodeId?: string | null;
  selectedNodeId: string | null;
}

/** Overlay code editor with line numbers, syntax highlighting, and cost gutter. */
export function CodeEditor({
  dimmed,
  disabled,
  onFieldSelect,
  onQueryChange,
  queryText,
  result,
  scanningNodeId,
  selectedNodeId,
}: CodeEditorProps) {
  const backdropRef = useRef<HTMLPreElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const lineNumsRef = useRef<HTMLDivElement>(null);

  const flatNodes = useMemo(() => (result?.nodes ? flattenNodes(result.nodes) : []), [result]);

  const lineNodeMap = useMemo(() => {
    const map = new Map<number, AnalysisNode>();
    for (const node of flatNodes) {
      if (node.startLine > 0) {
        map.set(node.startLine, node);
      }
    }
    return map;
  }, [flatNodes]);

  /** Index of the currently scanning node within `flatNodes`. */
  const scanIndex = useMemo(() => {
    if (!scanningNodeId) return -1;
    return flatNodes.findIndex((n) => n.id === scanningNodeId);
  }, [flatNodes, scanningNodeId]);

  /** Map node ID → index in flatNodes for scan state derivation. */
  const nodeIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    for (let i = 0; i < flatNodes.length; i++) {
      map.set(flatNodes[i]!.id, i);
    }
    return map;
  }, [flatNodes]);

  const lines = useMemo(() => queryText.split("\n"), [queryText]);
  const totalCost = result?.complexity ?? 0;

  // --- Scroll synchronization ---

  const handleScroll = useCallback((e: React.UIEvent<HTMLTextAreaElement>) => {
    const { scrollLeft, scrollTop } = e.currentTarget;
    requestAnimationFrame(() => {
      if (backdropRef.current) {
        backdropRef.current.scrollLeft = scrollLeft;
        backdropRef.current.scrollTop = scrollTop;
      }
      if (gutterRef.current) {
        gutterRef.current.scrollTop = scrollTop;
      }
      if (lineNumsRef.current) {
        lineNumsRef.current.scrollTop = scrollTop;
      }
    });
  }, []);

  // --- Keyboard handling ---

  const handleKeydown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        const textarea = e.currentTarget;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const val = textarea.value;
        const next = `${val.substring(0, start)}  ${val.substring(end)}`;
        onQueryChange(next);
        requestAnimationFrame(() => {
          textarea.selectionStart = start + 2;
          textarea.selectionEnd = start + 2;
        });
      }
    },
    [onQueryChange],
  );

  // --- Click-to-select (textarea, line numbers, gutter) ---

  /** Resolve the line number from the textarea cursor position and select the node. */
  const handleTextareaClick = useCallback(
    (e: React.MouseEvent<HTMLTextAreaElement>) => {
      const textarea = e.currentTarget;
      const cursorPos = textarea.selectionStart;
      const textBefore = textarea.value.substring(0, cursorPos);
      const lineNum = textBefore.split("\n").length;
      const node = lineNodeMap.get(lineNum);
      onFieldSelect(node?.id ?? null);
    },
    [lineNodeMap, onFieldSelect],
  );

  const handleLineNumberClick = useCallback(
    (lineNum: number) => {
      const node = lineNodeMap.get(lineNum);
      if (node) onFieldSelect(node.id);
    },
    [lineNodeMap, onFieldSelect],
  );

  const handleGutterClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>("[data-node-id]");
      if (row?.dataset.nodeId) {
        onFieldSelect(row.dataset.nodeId);
      }
    },
    [onFieldSelect],
  );

  // --- Scan state helper ---

  /** Return the scan CSS class for a node given its index in flatNodes. */
  const scanClassForIndex = useCallback(
    (idx: number): string => {
      if (!dimmed || scanIndex < 0) return "";
      if (idx === scanIndex) return "ce-scan-active";
      if (idx < scanIndex) return "ce-scan-done";
      return "ce-scan-dim";
    },
    [dimmed, scanIndex],
  );

  // --- Backdrop HTML ---

  const backdropHtml = useMemo(() => {
    let html = "";
    for (let i = 0; i < lines.length; i++) {
      const lineNum = i + 1;
      const lineText = lines[i] ?? "";
      const node = lineNodeMap.get(lineNum);

      if (node) {
        const ratio = totalCost > 0 ? node.totalCost / totalCost : 0;
        const isSelected = node.id === selectedNodeId;
        const nodeIdx = nodeIndexMap.get(node.id) ?? -1;
        const scanCls = scanClassForIndex(nodeIdx);
        const classes = [
          "ce-line",
          "ce-line-field",
          `ce-category-${node.category}`,
          isSelected ? "ce-selected" : "",
          scanCls,
        ]
          .filter(Boolean)
          .join(" ");
        const costRatio = Math.min(ratio * 100, 100);

        html += `<div class="${classes}" data-line="${lineNum}" data-node-id="${node.id}" style="--cost-ratio: ${costRatio}%">${highlightFieldLine(lineText, node)}\n</div>`;
      } else if (lineText.trim() === "") {
        const scanCls = dimmed ? "ce-scan-dim" : "";
        const cls = `ce-line ce-line-empty${scanCls ? ` ${scanCls}` : ""}`;
        html += `<div class="${cls}" data-line="${lineNum}">\n</div>`;
      } else {
        const scanCls = dimmed ? "ce-scan-dim" : "";
        const cls = `ce-line ce-line-plain${scanCls ? ` ${scanCls}` : ""}`;
        html += `<div class="${cls}" data-line="${lineNum}">${highlightPlainLine(lineText)}\n</div>`;
      }
    }
    return html;
  }, [dimmed, lines, lineNodeMap, nodeIndexMap, scanClassForIndex, selectedNodeId, totalCost]);

  // --- Gutter HTML ---

  const gutterHtml = useMemo(() => {
    let html = "";
    for (let i = 0; i < lines.length; i++) {
      const lineNum = i + 1;
      const node = lineNodeMap.get(lineNum);
      const isSelected = node?.id === selectedNodeId;

      if (node) {
        const color = costColor(node.totalCost, totalCost);
        const nodeIdx = nodeIndexMap.get(node.id) ?? -1;
        const scanCls = scanClassForIndex(nodeIdx);
        const rowClasses = [
          "ce-gutter-row",
          isSelected ? "ce-gutter-selected" : "",
          scanCls ? `ce-gutter-${scanCls.replace("ce-scan-", "")}` : "",
        ]
          .filter(Boolean)
          .join(" ");

        html += `<div class="${rowClasses}" data-node-id="${node.id}">`;
        if (node.multiplier > 1) {
          html += `<span class="ce-gutter-badge ce-gutter-multiplier">\u00d7${node.multiplier}</span>`;
        }
        html += `<span class="ce-gutter-badge ce-gutter-cost" style="color: ${color}; border-color: ${color}40">${formatNumber(node.totalCost)}</span>`;
        html += "</div>";
      } else {
        const scanCls = dimmed ? "ce-gutter-dim" : "";
        html += `<div class="ce-gutter-row${scanCls ? ` ${scanCls}` : ""}"></div>`;
      }
    }
    return html;
  }, [dimmed, lines, lineNodeMap, nodeIndexMap, scanClassForIndex, selectedNodeId, totalCost]);

  return (
    <div className="code-editor">
      {/* Line numbers */}
      <div className="code-editor-line-numbers" ref={lineNumsRef}>
        {lines.map((_, i) => {
          const lineNum = i + 1;
          const node = lineNodeMap.get(lineNum);
          const isActive = node?.id === selectedNodeId;
          const hasNode = !!node;

          // Scan dim state for line numbers
          let lnScanClass = "";
          if (dimmed && node) {
            const nodeIdx = nodeIndexMap.get(node.id) ?? -1;
            if (nodeIdx === scanIndex) lnScanClass = " ce-ln-active";
            else if (nodeIdx < scanIndex) lnScanClass = " ce-ln-done";
            else lnScanClass = " ce-ln-dim";
          } else if (dimmed) {
            lnScanClass = " ce-ln-dim";
          }

          return (
            <div
              className={`ce-line-number${isActive ? " ce-line-number-active" : ""}${hasNode ? " ce-line-number-clickable" : ""}${lnScanClass}`}
              key={lineNum}
              onClick={hasNode ? () => handleLineNumberClick(lineNum) : undefined}
            >
              {lineNum}
            </div>
          );
        })}
      </div>

      {/* Editor body (backdrop + textarea) */}
      <div className="code-editor-body">
        <pre
          className="code-editor-backdrop"
          dangerouslySetInnerHTML={{ __html: backdropHtml }}
          ref={backdropRef}
        />
        <textarea
          className={`code-editor-input${disabled ? " disabled" : ""}`}
          onChange={(e) => onQueryChange(e.target.value)}
          onClick={disabled ? undefined : handleTextareaClick}
          onKeyDown={disabled ? undefined : handleKeydown}
          onScroll={handleScroll}
          placeholder="Type a GraphQL query..."
          readOnly={disabled}
          spellCheck={false}
          value={queryText}
        />
      </div>

      {/* Cost gutter */}
      <div
        className="code-editor-gutter"
        dangerouslySetInnerHTML={{ __html: gutterHtml }}
        onClick={handleGutterClick}
        ref={gutterRef}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Syntax highlighting helpers
// ---------------------------------------------------------------------------

/** Highlight a line that maps to an analysis node. */
function highlightFieldLine(lineText: string, node: AnalysisNode): string {
  let result = escapeHtml(lineText);

  const namePattern = new RegExp(`\\b${escapeRegex(node.fieldName)}\\b`);
  result = result.replace(
    namePattern,
    `<span class="ce-field-name">${escapeHtml(node.fieldName)}</span>`,
  );

  for (const argName of node.multiplierArgs) {
    const val = node.args[argName];
    if (val !== undefined) {
      const valStr = String(val);
      result = result.replace(
        new RegExp(`\\b${escapeRegex(valStr)}\\b`),
        `<span class="ce-multiplier-value">${escapeHtml(valStr)}</span>`,
      );
    }
  }

  result = result.replace(/([{}()])/g, '<span class="ce-brace">$1</span>');
  return result;
}

/** Highlight a plain line (no analysis node). */
function highlightPlainLine(lineText: string): string {
  let result = escapeHtml(lineText);
  result = result.replace(/([{}])/g, '<span class="ce-brace">$1</span>');
  result = result.replace(
    /\b(fragment|mutation|on|query|subscription)\b/g,
    '<span class="ce-keyword">$1</span>',
  );
  return result;
}
