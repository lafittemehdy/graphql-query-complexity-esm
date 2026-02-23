/**
 * Horizontal preset tab bar above the editor area.
 *
 * Shows a row of preset buttons with the active preset's description
 * displayed below for educational context.
 *
 * @module PresetBar
 */

import { useMemo } from "react";

import { PRESETS } from "../lib/presets";

interface PresetBarProps {
  activePresetId: string | null;
  onSelect: (presetId: string) => void;
}

/** Compact horizontal row of preset buttons with active description. */
export function PresetBar({ activePresetId, onSelect }: PresetBarProps) {
  const activeDescription = useMemo(
    () => PRESETS.find((p) => p.id === activePresetId)?.description ?? null,
    [activePresetId],
  );

  return (
    <div className="preset-bar">
      <div className="preset-bar-buttons">
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
      </div>
      {activeDescription && <p className="preset-description">{activeDescription}</p>}
    </div>
  );
}
