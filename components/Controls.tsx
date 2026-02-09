"use client";

import { useMemo } from "react";
import { houseModelLabel, type HouseModelKey } from "@/lib/houseModels";

export type MetricKey = "house" | "houseDelta" | "ec" | "ecDelta" | "ecPerMillion";

type ControlsProps = {
  totalSeats: number;
  onTotalSeatsChange: (value: number) => void;
  houseModel: HouseModelKey;
  onHouseModelChange: (value: HouseModelKey) => void;
  metric: MetricKey;
  onMetricChange: (metric: MetricKey) => void;
  darkMode: boolean;
  onToggleDarkMode: () => void;
  overlaysEnabled: boolean;
  onToggleOverlays: () => void;
  responsiveness: "low" | "medium" | "high";
  onResponsivenessChange: (value: "low" | "medium" | "high") => void;
  onReset: () => void;
  onShare: () => void;
};

const metrics: { key: MetricKey; label: string; description: string }[] = [
  { key: "house", label: "House seats", description: "Total House seats at N" },
  {
    key: "houseDelta",
    label: "House change vs 435",
    description: "Seat gains/losses vs baseline",
  },
  { key: "ec", label: "Electoral College", description: "House seats + 2" },
  {
    key: "ecDelta",
    label: "EC change vs 435",
    description: "Electoral College shift vs baseline",
  },
  {
    key: "ecPerMillion",
    label: "EC per million",
    description: "Electoral College votes per million residents",
  },
];

const modelOptions: HouseModelKey[] = [
  "manual",
  "cubeRoot",
  "proportional500k",
  "wyomingRule",
];

export default function Controls({
  totalSeats,
  onTotalSeatsChange,
  houseModel,
  onHouseModelChange,
  metric,
  onMetricChange,
  darkMode,
  onToggleDarkMode,
  overlaysEnabled,
  onToggleOverlays,
  responsiveness,
  onResponsivenessChange,
  onReset,
  onShare,
}: ControlsProps) {
  const min = 435;
  const max = 1200;
  const metricDescription = useMemo(
    () => metrics.find((option) => option.key === metric)?.description,
    [metric]
  );

  return (
    <div className="card space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="label">House size</p>
          <h2 className="text-2xl font-semibold">{totalSeats} seats</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Adjust the total size of the U.S. House of Representatives.
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Active model: {houseModelLabel(houseModel)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="button" onClick={onReset}>
            Reset
          </button>
          <button type="button" className="button" onClick={onShare}>
            Share link
          </button>
          <button type="button" className="button" onClick={onToggleDarkMode}>
            {darkMode ? "Light mode" : "Dark mode"}
          </button>
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <p className="label">House expansion model</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {modelOptions.map((option) => (
              <button
                type="button"
                key={option}
                className={`button w-full justify-start ${
                  houseModel === option ? "button-primary" : ""
                }`}
                onClick={() => onHouseModelChange(option)}
              >
                <span className="text-sm font-semibold">{houseModelLabel(option)}</span>
              </button>
            ))}
          </div>
        </div>

        <input
          aria-label="Total House seats"
          type="range"
          min={min}
          max={max}
          value={totalSeats}
          disabled={houseModel !== "manual"}
          onChange={(event) => onTotalSeatsChange(Number(event.target.value))}
          className="h-2 w-full cursor-pointer appearance-none rounded-full bg-slate-200 disabled:cursor-not-allowed dark:bg-slate-800"
        />
        <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400">
          <span>{min}</span>
          <span>{max}</span>
        </div>
        {houseModel !== "manual" && (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Slider is disabled while a formula model is active.
          </p>
        )}
      </div>

      <div>
        <p className="label">Map + table metric</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {metrics.map((option) => (
            <button
              type="button"
              key={option.key}
              className={`button w-full justify-start ${
                metric === option.key ? "button-primary" : ""
              }`}
              onClick={() => onMetricChange(option.key)}
            >
              <span className="text-sm font-semibold">{option.label}</span>
            </button>
          ))}
        </div>
        {metricDescription && (
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            {metricDescription}
          </p>
        )}
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="label">Simulation overlays</p>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Teaching tools only - not predictions.
            </p>
          </div>
          <button
            type="button"
            className={`button ${overlaysEnabled ? "button-primary" : ""}`}
            onClick={onToggleOverlays}
          >
            {overlaysEnabled ? "On" : "Off"}
          </button>
        </div>
        <div className="rounded-xl border border-dashed border-slate-200 p-4 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
          <p className="font-semibold text-slate-700 dark:text-slate-200">
            Seat-vote curve responsiveness
          </p>
          <p className="mt-1">
            Placeholder curve applied to each state&apos;s Party A vote share.
          </p>
          <div className="mt-3 flex gap-2">
            {(["low", "medium", "high"] as const).map((option) => (
              <button
                type="button"
                key={option}
                className={`button ${
                  responsiveness === option ? "button-primary" : ""
                }`}
                onClick={() => onResponsivenessChange(option)}
              >
                {option}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

