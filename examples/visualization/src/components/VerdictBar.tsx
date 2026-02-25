/**
 * Bottom verdict bar — cost display, inline limit stepper, gauge, pass/blocked badge.
 *
 * Supports animation overrides: `costOverride` for the climbing counter,
 * `danger` for the red cost state, `badgeVisible` for fade-in timing,
 * and `shaking` for the verdict shake.
 *
 * @module VerdictBar
 */

import { useCallback, useEffect, useRef } from "react";
import { formatNumber } from "../lib/utils";
import type { AnalysisResult } from "../types/analysis";

/**
 * Fire `callback` on press, then auto-repeat with acceleration while held.
 *
 * Timing: initial delay 400 ms → 120 ms repeats → 50 ms after 6 ticks.
 */
function useHoldRepeat(callback: () => void): {
  onPointerDown: () => void;
  onPointerLeave: () => void;
  onPointerUp: () => void;
} {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ticksRef = useRef(0);

  const stop = useCallback(() => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    ticksRef.current = 0;
  }, []);

  const schedule = useCallback(() => {
    const delay = ticksRef.current < 6 ? 120 : 50;
    timerRef.current = setTimeout(() => {
      callback();
      ticksRef.current += 1;
      schedule();
    }, delay);
  }, [callback]);

  const start = useCallback(() => {
    stop();
    callback();
    timerRef.current = setTimeout(() => {
      callback();
      ticksRef.current = 1;
      schedule();
    }, 400);
  }, [callback, schedule, stop]);

  useEffect(() => stop, [stop]);

  return { onPointerDown: start, onPointerLeave: stop, onPointerUp: stop };
}

/** Adaptive step: ~10% of current limit, snapped to a clean number. */
function getStep(limit: number): number {
  if (limit < 20) return 1;
  const raw = limit * 0.1;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  return Math.max(1, Math.round(raw / magnitude) * magnitude);
}

interface VerdictBarProps {
  badgeVisible?: boolean;
  costOverride?: number | null;
  danger?: boolean;
  limit: number;
  onLimitChange: (limit: number) => void;
  result: AnalysisResult | null;
  shaking?: boolean;
}

/** Verdict bar with cost, inline limit stepper, gauge, and pass/blocked badge. */
export function VerdictBar({
  badgeVisible = true,
  costOverride,
  danger,
  limit,
  onLimitChange,
  result,
  shaking,
}: VerdictBarProps) {
  const cost = costOverride ?? result?.complexity ?? 0;
  const hasCost = costOverride != null || result != null;
  const passed = limit > 0 ? cost <= limit : true;
  const ratio = limit > 0 ? cost / limit : 0;
  const gaugeWidth = `${Math.min(ratio * 100, 100)}%`;
  const gaugeClass = ratio > 1 ? "crit" : "safe";

  const step = getStep(limit);

  const handleDecrement = useCallback(() => {
    const next = limit - step;
    // Snap to cost if stepping would cross it
    if (cost > 0 && cost < limit && cost > next) {
      onLimitChange(cost);
    } else {
      onLimitChange(Math.max(1, next));
    }
  }, [cost, limit, onLimitChange, step]);

  const handleIncrement = useCallback(() => {
    const next = limit + step;
    // Snap to cost if stepping would cross it
    if (cost > 0 && cost > limit && cost < next) {
      onLimitChange(cost);
    } else {
      onLimitChange(next);
    }
  }, [cost, limit, onLimitChange, step]);

  const decrementHold = useHoldRepeat(handleDecrement);
  const incrementHold = useHoldRepeat(handleIncrement);

  const handleCostClick = useCallback(() => {
    if (cost > 0) onLimitChange(cost);
  }, [cost, onLimitChange]);

  const handleInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = Number.parseInt(e.target.value, 10);
      if (Number.isFinite(val) && val > 0) {
        onLimitChange(val);
      }
    },
    [onLimitChange],
  );

  const costClassName = `verdict-cost${danger ? " verdict-cost-danger" : ""}${hasCost && cost > 0 ? " verdict-cost-clickable" : ""}`;

  return (
    <div className={`verdict-bar${shaking ? " verdict-shaking" : ""}`}>
      <span
        className={costClassName}
        onClick={hasCost && cost > 0 ? handleCostClick : undefined}
        title={hasCost && cost > 0 ? "Click to set limit to this cost" : undefined}
      >
        {hasCost ? formatNumber(cost) : "\u2014"}
      </span>
      <span className="verdict-separator">/</span>

      <div className="verdict-limit-stepper">
        <button
          className="editor-stepper-btn"
          onPointerDown={decrementHold.onPointerDown}
          onPointerLeave={decrementHold.onPointerLeave}
          onPointerUp={decrementHold.onPointerUp}
          title={`Decrease limit by ${step}`}
          type="button"
        >
          &minus;
        </button>
        <input
          className="editor-limit-input"
          min={5}
          onChange={handleInput}
          type="number"
          value={limit}
        />
        <button
          className="editor-stepper-btn"
          onPointerDown={incrementHold.onPointerDown}
          onPointerLeave={incrementHold.onPointerLeave}
          onPointerUp={incrementHold.onPointerUp}
          title={`Increase limit by ${step}`}
          type="button"
        >
          +
        </button>
      </div>

      <div className="verdict-gauge">
        <div className={`verdict-gauge-fill ${gaugeClass}`} style={{ width: gaugeWidth }} />
      </div>

      {hasCost && (
        <span
          className={`verdict-badge ${passed ? "verdict-badge-pass" : "verdict-badge-blocked"}${badgeVisible ? " verdict-badge-visible" : ""}`}
        >
          {passed ? "PASS" : "BLOCKED"}
        </span>
      )}
    </div>
  );
}
