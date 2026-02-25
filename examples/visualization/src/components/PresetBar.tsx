/**
 * Horizontal preset tab bar above the editor area.
 *
 * Renders preset buttons with the active preset's description inline,
 * pushed to the right on desktop and wrapping below on narrow screens.
 *
 * @module PresetBar
 */

import { useMemo } from "react";

import { PRESETS } from "../lib/presets";

interface PresetBarProps {
  activePresetId: string | null;
  onSelect: (presetId: string) => void;
}

/** Compact horizontal row of preset buttons with inline active description. */
export function PresetBar({ activePresetId, onSelect }: PresetBarProps) {
  const activeDescription = useMemo(
    () => PRESETS.find((p) => p.id === activePresetId)?.description ?? null,
    [activePresetId],
  );

  return (
    <div className="preset-bar">
      {PRESETS.map((preset) => (
        <button
          className={`preset-btn${preset.id === activePresetId ? " active" : ""}`}
          key={preset.id}
          onClick={() => onSelect(preset.id)}
          title={preset.description}
          type="button"
        >
          {preset.label}
        </button>
      ))}
      {activeDescription && (
        <span className="preset-description">{activeDescription}</span>
      )}
    </div>
  );
}
