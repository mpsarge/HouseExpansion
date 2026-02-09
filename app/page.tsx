"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Controls, { type MetricKey } from "@/components/Controls";
import USMap from "@/components/USMap";
import StateTable from "@/components/StateTable";
import populations from "@/data/populations.json";
import { apportion } from "@/lib/apportionment";
import {
  buildStateMetrics,
  formatNumber,
  type StateMetrics,
  type StatePopulation,
} from "@/lib/metrics";
import { hamiltonAllocation, seatShareFromVote } from "@/lib/overlays";

const DEFAULT_TOTAL = 435;
const DEFAULT_METRIC: MetricKey = "house";
const DEFAULT_RESPONSIVENESS: "low" | "medium" | "high" = "medium";

const parsePartyShares = (value: string | null, states: StatePopulation[]) => {
  const shares: Record<string, number> = {};
  states.forEach((state) => {
    shares[state.abbr] = 0.5;
  });
  if (!value) return shares;

  value.split(",").forEach((pair) => {
    const [abbr, share] = pair.split(":");
    const parsed = Number(share);
    if (abbr && !Number.isNaN(parsed)) {
      shares[abbr] = Math.min(0.9, Math.max(0.1, parsed));
    }
  });
  return shares;
};

const serializePartyShares = (shares: Record<string, number>) => {
  return Object.entries(shares)
    .filter(([_, share]) => share !== 0.5)
    .map(([abbr, share]) => `${abbr}:${share.toFixed(2)}`)
    .join(",");
};

export default function Home() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const stateData = populations as StatePopulation[];

  const [totalSeats, setTotalSeats] = useState(DEFAULT_TOTAL);
  const [metric, setMetric] = useState<MetricKey>(DEFAULT_METRIC);
  const [darkMode, setDarkMode] = useState(false);
  const [overlaysEnabled, setOverlaysEnabled] = useState(false);
  const [responsiveness, setResponsiveness] = useState(DEFAULT_RESPONSIVENESS);
  const [selectedState, setSelectedState] = useState<string | null>(null);
  const [partyShares, setPartyShares] = useState<Record<string, number>>({});

  useEffect(() => {
    const querySeats = Number(searchParams.get("N"));
    const queryMetric = searchParams.get("metric") as MetricKey | null;
    const queryOverlays = searchParams.get("overlays");
    const queryResponsiveness = searchParams.get("resp") as
      | "low"
      | "medium"
      | "high"
      | null;

    if (!Number.isNaN(querySeats) && querySeats >= 435) {
      setTotalSeats(Math.min(1200, querySeats));
    }
    if (queryMetric && ["house", "houseDelta", "ec", "ecDelta", "ecPerMillion"].includes(queryMetric)) {
      setMetric(queryMetric);
    }
    if (queryOverlays) {
      setOverlaysEnabled(queryOverlays === "1");
    }
    if (queryResponsiveness && ["low", "medium", "high"].includes(queryResponsiveness)) {
      setResponsiveness(queryResponsiveness);
    }
    setPartyShares(parsePartyShares(searchParams.get("partyA"), stateData));
  }, [searchParams, stateData]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
  }, [darkMode]);

  useEffect(() => {
    const params = new URLSearchParams();
    params.set("N", String(totalSeats));
    params.set("metric", metric);
    params.set("overlays", overlaysEnabled ? "1" : "0");
    params.set("resp", responsiveness);
    const shareString = serializePartyShares(partyShares);
    if (shareString) {
      params.set("partyA", shareString);
    }
    router.replace(`/?${params.toString()}`, { scroll: false });
  }, [totalSeats, metric, overlaysEnabled, responsiveness, partyShares, router]);

  const baselineSeats = useMemo(() => {
    const populationsByState: Record<string, number> = {};
    stateData
      .filter((state) => state.abbr !== "DC")
      .forEach((state) => {
        populationsByState[state.abbr] = state.population;
      });
    return apportion(populationsByState, DEFAULT_TOTAL);
  }, [stateData]);

  const apportionment = useMemo(() => {
    const populationsByState: Record<string, number> = {};
    stateData
      .filter((state) => state.abbr !== "DC")
      .forEach((state) => {
        populationsByState[state.abbr] = state.population;
      });
    return apportion(populationsByState, totalSeats);
  }, [stateData, totalSeats]);

  const metrics = useMemo(() => {
    return stateData.map((state) =>
      buildStateMetrics(state, apportionment, baselineSeats)
    );
  }, [stateData, apportionment, baselineSeats]);

  const metricsByState = useMemo(() => {
    const map: Record<string, StateMetrics> = {};
    metrics.forEach((entry) => {
      map[entry.abbr] = entry;
    });
    return map;
  }, [metrics]);

  const selectedMetrics = selectedState ? metricsByState[selectedState] : null;

  const totals = useMemo(() => {
    return metrics.reduce(
      (acc, entry) => {
        acc.population += entry.population;
        acc.house += entry.houseSeats;
        acc.ec += entry.ecVotes;
        return acc;
      },
      { population: 0, house: 0, ec: 0 }
    );
  }, [metrics]);

  const overlayTotals = useMemo(() => {
    let partyA = 0;
    let partyB = 0;
    let partyACurve = 0;
    let partyBCurve = 0;
    metrics.forEach((entry) => {
      if (entry.abbr === "DC") return;
      const share = partyShares[entry.abbr] ?? 0.5;
      const allocation = hamiltonAllocation(entry.houseSeats, share);
      partyA += allocation.partyA;
      partyB += allocation.partyB;

      const curvedShare = seatShareFromVote(share, responsiveness);
      const curveAllocation = hamiltonAllocation(entry.houseSeats, curvedShare);
      partyACurve += curveAllocation.partyA;
      partyBCurve += curveAllocation.partyB;
    });
    return { partyA, partyB, partyACurve, partyBCurve };
  }, [metrics, partyShares, responsiveness]);

  const handleReset = () => {
    setTotalSeats(DEFAULT_TOTAL);
    setMetric(DEFAULT_METRIC);
    setOverlaysEnabled(false);
    setResponsiveness(DEFAULT_RESPONSIVENESS);
    setPartyShares(parsePartyShares(null, stateData));
    setSelectedState(null);
  };

  const handleShare = async () => {
    const url = window.location.href;
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(url);
    }
  };

  return (
    <main className="min-h-screen pb-16">
      <div className="container-max py-10">
        <header className="mb-10 space-y-4">
          <p className="label">House Expansion Lab</p>
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
            Explore House size, apportionment, and Electoral College ripple effects
          </h1>
          <p className="max-w-3xl text-lg text-slate-600 dark:text-slate-300">
            Adjust the total House size and see how the Method of Equal Proportions
            reshapes state-by-state seats and Electoral College votes. Optional
            overlays simulate vote-to-seat translations as teaching tools — not
            forecasts.
          </p>
        </header>

        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <Controls
            totalSeats={totalSeats}
            onTotalSeatsChange={setTotalSeats}
            metric={metric}
            onMetricChange={setMetric}
            darkMode={darkMode}
            onToggleDarkMode={() => setDarkMode((prev) => !prev)}
            overlaysEnabled={overlaysEnabled}
            onToggleOverlays={() => setOverlaysEnabled((prev) => !prev)}
            responsiveness={responsiveness}
            onResponsivenessChange={setResponsiveness}
            onReset={handleReset}
            onShare={handleShare}
          />

          <div className="space-y-6">
            <div className="card">
              <p className="label">National totals</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <div>
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    Population
                  </p>
                  <p className="text-xl font-semibold">{formatNumber(totals.population)}</p>
                </div>
                <div>
                  <p className="text-sm text-slate-500 dark:text-slate-400">House</p>
                  <p className="text-xl font-semibold">{totals.house}</p>
                </div>
                <div>
                  <p className="text-sm text-slate-500 dark:text-slate-400">EC</p>
                  <p className="text-xl font-semibold">{totals.ec}</p>
                </div>
              </div>
            </div>

            <div className="card">
              <p className="label">Selected state</p>
              {selectedMetrics ? (
                <div className="mt-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-2xl font-semibold">
                      {selectedMetrics.state} ({selectedMetrics.abbr})
                    </h3>
                    <button
                      type="button"
                      className="button"
                      onClick={() => setSelectedState(null)}
                    >
                      Clear
                    </button>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <p className="text-sm text-slate-500 dark:text-slate-400">
                        Population
                      </p>
                      <p className="text-lg font-semibold">
                        {formatNumber(selectedMetrics.population)}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-slate-500 dark:text-slate-400">
                        House seats
                      </p>
                      <p className="text-lg font-semibold">
                        {selectedMetrics.houseSeats} ({selectedMetrics.houseDelta >= 0 ? "+" : ""}
                        {selectedMetrics.houseDelta} vs 435)
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-slate-500 dark:text-slate-400">
                        Electoral College
                      </p>
                      <p className="text-lg font-semibold">
                        {selectedMetrics.ecVotes} ({selectedMetrics.ecDelta >= 0 ? "+" : ""}
                        {selectedMetrics.ecDelta})
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-slate-500 dark:text-slate-400">
                        EC per million
                      </p>
                      <p className="text-lg font-semibold">
                        {formatNumber(selectedMetrics.ecPerMillion, 2)}
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">
                  Click a state on the map or table to pin its details here.
                </p>
              )}
            </div>

            {overlaysEnabled && (
              <div className="card space-y-4">
                <div>
                  <p className="label">Simulation overlays</p>
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    These overlays are illustrative simulations. They do not predict
                    election outcomes and do not depend on district geometry.
                  </p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
                    <p className="text-sm font-semibold">Proportional (Hamilton)</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Seats allocated from statewide Party A share.
                    </p>
                    <div className="mt-3 flex justify-between text-sm">
                      <span>Party A</span>
                      <span className="font-semibold">{overlayTotals.partyA}</span>
                    </div>
                    <div className="mt-1 flex justify-between text-sm">
                      <span>Party B</span>
                      <span className="font-semibold">{overlayTotals.partyB}</span>
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
                    <p className="text-sm font-semibold">Seat–vote curve</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Vote share adjusted by responsiveness: {responsiveness}.
                    </p>
                    <div className="mt-3 flex justify-between text-sm">
                      <span>Party A</span>
                      <span className="font-semibold">{overlayTotals.partyACurve}</span>
                    </div>
                    <div className="mt-1 flex justify-between text-sm">
                      <span>Party B</span>
                      <span className="font-semibold">{overlayTotals.partyBCurve}</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="mt-10 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <USMap
            metricsByState={metricsByState}
            metric={metric}
            selectedState={selectedState}
            onSelectState={setSelectedState}
          />
          {overlaysEnabled ? (
            <div className="card">
              <p className="label">Party A vote share inputs</p>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Adjust statewide Party A vote share used by overlay models.
              </p>
              <div className="mt-4 max-h-[420px] space-y-3 overflow-auto pr-2">
                {metrics
                  .filter((entry) => entry.abbr !== "DC")
                  .map((entry) => (
                    <div key={entry.abbr} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-semibold">
                          {entry.state} ({entry.abbr})
                        </span>
                        <span>{Math.round((partyShares[entry.abbr] ?? 0.5) * 100)}%</span>
                      </div>
                      <input
                        aria-label={`Party A share for ${entry.state}`}
                        type="range"
                        min={10}
                        max={90}
                        value={Math.round((partyShares[entry.abbr] ?? 0.5) * 100)}
                        onChange={(event) => {
                          const next = Number(event.target.value) / 100;
                          setPartyShares((prev) => ({ ...prev, [entry.abbr]: next }));
                        }}
                        className="h-2 w-full cursor-pointer appearance-none rounded-full bg-slate-200 dark:bg-slate-800"
                      />
                    </div>
                  ))}
              </div>
            </div>
          ) : (
            <div className="card">
              <p className="label">Simulation overlays</p>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Turn on overlays to explore proportional and seat–vote curve
                simulations.
              </p>
              <ul className="mt-4 space-y-3 text-sm text-slate-600 dark:text-slate-300">
                <li>• Proportional-by-statewide-vote overlay (Hamilton method).</li>
                <li>• Seat–vote curve overlay (low/medium/high responsiveness).</li>
                <li>• Results are explicitly simulations, not forecasts.</li>
              </ul>
            </div>
          )}
        </div>

        <div className="mt-10">
          <StateTable
            rows={metrics}
            metric={metric}
            onSelectState={setSelectedState}
          />
        </div>
      </div>
    </main>
  );
}
