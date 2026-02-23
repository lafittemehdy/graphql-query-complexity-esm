/**
 * Root application component — all state lives here.
 *
 * Layout: Header → PresetBar → (CodeEditor + ScanLog|DetailPanel) → VerdictBar
 *
 * First-visit animation ("The Scan") plays directly in the live UI:
 * lines dim, a scanner walks field-by-field lighting each one up,
 * the ScanLog panel builds an audit trail of costs on the right,
 * the verdict bar counter climbs with dramatic jumps on multiplied fields,
 * then a beat of silence before the BLOCKED verdict.
 *
 * @module App
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CodeEditor } from "./components/CodeEditor";
import { DetailPanel } from "./components/DetailPanel";
import { Header } from "./components/Header";
import { PresetBar } from "./components/PresetBar";
import { ScanLog } from "./components/ScanLog";
import { VerdictBar } from "./components/VerdictBar";
import { WelcomePrompt } from "./components/WelcomePrompt";
import { useAnalysis } from "./hooks/useAnalysis";
import { flattenNodes } from "./lib/analysis-engine";
import { DEFAULT_PRESET_ID, PRESETS } from "./lib/presets";
import {
  animateValue,
  computeCostSteps,
  findMostInterestingNode,
  isIntroDisabled,
} from "./lib/utils";

const DEFAULT_PRESET = PRESETS.find((p) => p.id === DEFAULT_PRESET_ID)!;
const REDUCED_MOTION =
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Root application component. */
export function App() {
  // --- Core state ---
  const [activePresetId, setActivePresetId] = useState<string | null>(DEFAULT_PRESET_ID);
  const [limit, setLimit] = useState(DEFAULT_PRESET.limit);
  const [queryText, setQueryText] = useState(DEFAULT_PRESET.query);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [showWelcome, setShowWelcome] = useState(!isIntroDisabled());

  // --- Animation state (starts in playground mode) ---
  const [badgeVisible, setBadgeVisible] = useState(true);
  const [costOverride, setCostOverride] = useState<number | null>(null);
  const [danger, setDanger] = useState(false);
  const [dimmed, setDimmed] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const [scanComplete, setScanComplete] = useState(false);
  const [scanIndex, setScanIndex] = useState(-1);
  const [scanningNodeId, setScanningNodeId] = useState<string | null>(null);
  const [shaking, setShaking] = useState(false);

  const analysisResult = useAnalysis(queryText, limit);
  const animCancelsRef = useRef<(() => void)[]>([]);
  const skippedRef = useRef(false);

  // --- Flat nodes & cost steps ---

  const flatNodes = useMemo(
    () => (analysisResult?.nodes ? flattenNodes(analysisResult.nodes) : []),
    [analysisResult],
  );

  const costSteps = useMemo(
    () => computeCostSteps(flatNodes, analysisResult?.complexity ?? 0),
    [flatNodes, analysisResult],
  );

  // Auto-select most interesting node when analysis changes (only when not animating)
  useEffect(() => {
    if (isAnimating) return;
    if (flatNodes.length === 0) {
      setSelectedNodeId(null);
      return;
    }
    const target = findMostInterestingNode(flatNodes);
    setSelectedNodeId(target?.id ?? null);
  }, [flatNodes, isAnimating]);

  // --- Finish / skip helpers ---

  const finishAnimation = useCallback(() => {
    for (const cancel of animCancelsRef.current) cancel();
    animCancelsRef.current = [];

    setBadgeVisible(true);
    setCostOverride(null);
    setDanger(false);
    setDimmed(false);
    setIsAnimating(false);
    setScanComplete(false);
    setScanIndex(-1);
    setScanningNodeId(null);
    setShaking(false);
  }, []);

  const skipAnimation = useCallback(() => {
    if (!isAnimating || skippedRef.current) return;
    skippedRef.current = true;
    finishAnimation();
  }, [isAnimating, finishAnimation]);

  // --- The Scan: animation sequence ---

  useEffect(() => {
    if (!isAnimating) return;
    skippedRef.current = false;

    const cancels: (() => void)[] = [];
    animCancelsRef.current = cancels;

    /** Schedule a callback after `ms` (cancellable). */
    function after(ms: number, fn: () => void): void {
      const t = setTimeout(() => {
        if (!skippedRef.current) fn();
      }, ms);
      cancels.push(() => clearTimeout(t));
    }

    // Reduced motion: show final state instantly
    if (REDUCED_MOTION) {
      after(300, finishAnimation);
      return;
    }

    // Wait for analysis result before scanning
    if (!analysisResult?.nodes || flatNodes.length === 0) return;

    // Phase 0: Cold Open — everything dimmed, cost at 0
    setDimmed(true);
    setScanIndex(-1);
    setScanningNodeId(null);
    setCostOverride(0);
    setBadgeVisible(false);
    setDanger(false);

    let elapsed = 400; // 400ms of stillness

    // Phase 1: The Scan — walk through nodes sequentially
    for (let i = 0; i < flatNodes.length; i++) {
      const node = flatNodes[i]!;
      const isMultiplied = node.multiplier > 1;
      const prevCost = i > 0 ? (costSteps[i - 1] ?? 0) : 0;
      const targetCost = costSteps[i] ?? 0;
      const duration = isMultiplied ? 400 : 180;

      const nodeStartTime = elapsed;

      after(nodeStartTime, () => {
        // Light up this node and add it to the scan log
        setScanIndex(i);
        setScanningNodeId(node.id);

        if (isMultiplied && targetCost - prevCost > 50) {
          // Dramatic: animate the cost climbing rapidly
          const cancelAnim = animateValue(prevCost, targetCost, duration * 0.8, (v) => {
            if (!skippedRef.current) {
              setCostOverride(v);
              if (v > limit) setDanger(true);
            }
          });
          cancels.push(cancelAnim);
        } else {
          // Instant jump for leaf/simple nodes
          setCostOverride(targetCost);
          if (targetCost > limit) setDanger(true);
        }
      });

      elapsed += duration;
    }

    // Phase 2: The Silence — all lines return, number sits there
    after(elapsed, () => {
      setScanningNodeId(null);
      setDimmed(false);
      setCostOverride(null); // Show real cost
    });
    elapsed += 500;

    // Phase 3: The Verdict — BLOCKED + shake + auto-select
    after(elapsed, () => {
      setBadgeVisible(true);
      setShaking(true);

      after(250, () => setShaking(false));

      // Auto-select the most interesting node
      const target = findMostInterestingNode(flatNodes);
      setSelectedNodeId(target?.id ?? null);
    });
    elapsed += 400;

    // Phase 4: Holding — scan stays visible, CTA appears
    after(elapsed, () => {
      setDanger(false);
      setScanComplete(true);
    });

    return () => {
      for (const c of cancels) c();
    };
  }, [isAnimating, analysisResult, costSteps, flatNodes, limit, finishAnimation]);

  // --- Transition from holding to playground ---

  const handleExplore = useCallback(() => {
    setScanComplete(false);
    setScanIndex(-1);
    setScanningNodeId(null);
    setIsAnimating(false);
    setDanger(false);

    // Auto-select the most interesting node for the detail panel
    const target = findMostInterestingNode(flatNodes);
    setSelectedNodeId(target?.id ?? null);
  }, [flatNodes]);

  // --- Skip animation on any click or keypress ---

  useEffect(() => {
    if (!isAnimating) return;

    const handler = () => {
      // During holding phase, transition to playground instead of skipping
      if (scanComplete) {
        handleExplore();
      } else {
        skipAnimation();
      }
    };

    // Small delay so the initial page load doesn't immediately skip
    const t = setTimeout(() => {
      document.addEventListener("click", handler);
      document.addEventListener("keydown", handler);
    }, 100);

    return () => {
      clearTimeout(t);
      document.removeEventListener("click", handler);
      document.removeEventListener("keydown", handler);
    };
  }, [isAnimating, scanComplete, skipAnimation, handleExplore]);

  // --- Welcome prompt handlers ---

  const handleWelcomePlay = useCallback(() => {
    setShowWelcome(false);
    // Trigger the scan animation (same as replay)
    setBadgeVisible(false);
    setCostOverride(0);
    setDanger(false);
    setDimmed(true);
    setIsAnimating(true);
    setScanComplete(false);
    setScanIndex(-1);
    setScanningNodeId(null);
    setSelectedNodeId(null);
    setShaking(false);
  }, []);

  const handleWelcomeSkip = useCallback(() => {
    setShowWelcome(false);
  }, []);

  // --- Handlers ---

  const handlePresetSelect = useCallback((presetId: string) => {
    const preset = PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    setActivePresetId(presetId);
    setLimit(preset.limit);
    setQueryText(preset.query);
  }, []);

  const handleQueryChange = useCallback((text: string) => {
    setActivePresetId(null);
    setQueryText(text);
  }, []);

  const handleFieldSelect = useCallback((nodeId: string | null) => {
    setSelectedNodeId(nodeId);
  }, []);

  const handleDetailClose = useCallback(() => {
    setSelectedNodeId(null);
  }, []);

  const handleReplay = useCallback(() => {
    setBadgeVisible(false);
    setCostOverride(0);
    setDanger(false);
    setDimmed(true);
    setIsAnimating(true);
    setScanComplete(false);
    setScanIndex(-1);
    setScanningNodeId(null);
    setSelectedNodeId(null);
    setShaking(false);
  }, []);

  // Close detail panel on Escape (when not animating)
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && selectedNodeId && !isAnimating) {
        setSelectedNodeId(null);
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [selectedNodeId, isAnimating]);

  return (
    <>
      {showWelcome && <WelcomePrompt onPlay={handleWelcomePlay} onSkip={handleWelcomeSkip} />}
      <Header onReplay={handleReplay} />

      <div className="playground">
        <div className="playground-body">
          <PresetBar activePresetId={activePresetId} onSelect={handlePresetSelect} />

          <div className="editor-area">
            <CodeEditor
              dimmed={dimmed}
              disabled={isAnimating}
              onFieldSelect={handleFieldSelect}
              onQueryChange={handleQueryChange}
              queryText={queryText}
              result={analysisResult}
              scanningNodeId={scanningNodeId}
              selectedNodeId={selectedNodeId}
            />
            {isAnimating ? (
              <ScanLog
                complete={scanComplete}
                costSteps={costSteps}
                flatNodes={flatNodes}
                onExplore={handleExplore}
                scanIndex={scanIndex}
                totalLines={queryText.split("\n").length}
              />
            ) : (
              <DetailPanel
                onClose={handleDetailClose}
                onNavigate={handleFieldSelect}
                result={analysisResult}
                selectedNodeId={selectedNodeId}
              />
            )}
          </div>

          <VerdictBar
            badgeVisible={badgeVisible}
            costOverride={costOverride}
            danger={danger}
            limit={limit}
            onLimitChange={setLimit}
            result={analysisResult}
            shaking={shaking}
          />
        </div>
      </div>
    </>
  );
}
