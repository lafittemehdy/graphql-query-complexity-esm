/**
 * Welcome prompt — full-screen overlay shown on reload.
 *
 * Asks the user whether to watch the scan animation or skip
 * straight to the interactive playground. Includes an opt-out
 * checkbox to permanently disable the prompt.
 *
 * @module WelcomePrompt
 */

import { useCallback, useState } from "react";

import { disableIntro } from "../lib/utils";

interface WelcomePromptProps {
  onPlay: () => void;
  onSkip: () => void;
}

/** Full-screen welcome overlay with play/skip options. */
export function WelcomePrompt({ onPlay, onSkip }: WelcomePromptProps) {
  const [dontShow, setDontShow] = useState(false);

  const handlePlay = useCallback(() => {
    if (dontShow) disableIntro();
    onPlay();
  }, [dontShow, onPlay]);

  const handleSkip = useCallback(() => {
    if (dontShow) disableIntro();
    onSkip();
  }, [dontShow, onSkip]);

  return (
    <div className="welcome">
      <div className="welcome-content">
        <h1 className="welcome-title">graphql-query-complexity-esm</h1>
        <p className="welcome-subtitle">See how query costs compound, field by field.</p>

        <button className="welcome-play" onClick={handlePlay} type="button">
          Watch the scan <span className="welcome-play-arrow">&rarr;</span>
        </button>

        <button className="welcome-skip" onClick={handleSkip} type="button">
          skip to playground
        </button>

        <label className="welcome-opt-out">
          <input
            checked={dontShow}
            onChange={(e) => setDontShow(e.target.checked)}
            type="checkbox"
          />
          <span>Don&apos;t show on reload</span>
        </label>
      </div>
    </div>
  );
}
