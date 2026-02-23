/**
 * Shared utility functions: color mapping, easing, formatting.
 *
 * @module utils
 */

import type { AnalysisNode } from "../types/analysis";

// ---------------------------------------------------------------------------
// Color mapping
// ---------------------------------------------------------------------------

/**
 * Return a hex color for a field's cost relative to the total.
 *
 * Uses the depth-limit visualization palette:
 * - Muted (#666) for negligible cost
 * - Success green (#80B858) for low cost
 * - Accent gold (#D4A24C) for medium cost
 * - Multiplier orange (#D88A62) for high cost
 * - Error red (#C86860) for dominant cost
 */
export function costColor(cost: number, totalCost: number): string {
  if (totalCost <= 0) return "#666";
  const ratio = cost / totalCost;
  if (ratio < 0.01) return "#666";
  if (ratio < 0.1) return "#80B858";
  if (ratio < 0.3) return "#D4A24C";
  if (ratio < 0.6) return "#D88A62";
  return "#C86860";
}

/**
 * Return a CSS class for the pressure gauge based on cost/limit ratio.
 */
export function pressureClass(ratio: number): "crit" | "safe" {
  return ratio > 1 ? "crit" : "safe";
}

// ---------------------------------------------------------------------------
// Animation / easing
// ---------------------------------------------------------------------------

/** Cubic ease-out: fast start, slow finish. */
export function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

/**
 * Animate a numeric value from `start` to `end` over `duration` ms.
 *
 * @returns A cancel function.
 */
export function animateValue(
  start: number,
  end: number,
  duration: number,
  onUpdate: (value: number) => void,
  onComplete?: () => void,
): () => void {
  const startTime = performance.now();
  let cancelled = false;
  let rafId = 0;

  function tick(now: number): void {
    if (cancelled) return;
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = easeOutCubic(progress);
    const value = Math.round(start + (end - start) * eased);
    onUpdate(value);

    if (progress < 1) {
      rafId = requestAnimationFrame(tick);
    } else {
      onComplete?.();
    }
  }

  rafId = requestAnimationFrame(tick);
  return () => {
    cancelled = true;
    cancelAnimationFrame(rafId);
  };
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** Format a number with locale-aware thousand separators. */
export function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

/** Escape special regex characters in a string. */
export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Escape HTML special characters for safe insertion into innerHTML. */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ---------------------------------------------------------------------------
// Intro state persistence
// ---------------------------------------------------------------------------

const INTRO_DISABLED_KEY = "gqc-intro-disabled";

/** Check whether the user has permanently disabled the intro prompt. */
export function isIntroDisabled(): boolean {
  try {
    return localStorage.getItem(INTRO_DISABLED_KEY) === "1";
  } catch {
    return false;
  }
}

/** Permanently disable the intro prompt on future reloads. */
export function disableIntro(): void {
  try {
    localStorage.setItem(INTRO_DISABLED_KEY, "1");
  } catch {
    // Ignore storage errors
  }
}

// ---------------------------------------------------------------------------
// Animation helpers
// ---------------------------------------------------------------------------

/**
 * Distribute total complexity across nodes as cumulative cost steps.
 *
 * Leaf nodes are weighted by `totalCost` (their effective cost with
 * accumulated multipliers), while non-leaf nodes only contribute their
 * `baseCost`. This creates a gradual buildup for container fields and
 * dramatic explosions for deeply nested leaves where multipliers compound.
 *
 * The final step always equals `totalComplexity`.
 */
export function computeCostSteps(nodes: AnalysisNode[], totalComplexity: number): number[] {
  if (nodes.length === 0) return [];
  const weights = nodes.map((n) =>
    n.children.length > 0 ? Math.max(n.baseCost, 1) : Math.max(n.totalCost, 1),
  );
  const sumWeights = weights.reduce((a, b) => a + b, 0);
  let running = 0;
  return weights.map((w) => {
    running += (w / sumWeights) * totalComplexity;
    return Math.round(running);
  });
}

// ---------------------------------------------------------------------------
// Analysis helpers
// ---------------------------------------------------------------------------

/**
 * Find the most "interesting" node to auto-select after analysis.
 *
 * Prefers the most expensive multiplied node (the "aha moment"),
 * then falls back to the most expensive node overall.
 */
export function findMostInterestingNode(flatNodes: AnalysisNode[]): AnalysisNode | null {
  if (flatNodes.length === 0) return null;

  const multiplied = flatNodes.filter((n) => n.multiplier > 1);
  if (multiplied.length > 0) {
    return multiplied.reduce((best, n) => (n.totalCost > best.totalCost ? n : best));
  }

  return flatNodes.reduce((best, n) => (n.totalCost > best.totalCost ? n : best));
}
