"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import {
  hamiltonAllocation,
  hamiltonThreePartyAllocation,
  seatShareFromVote,
} from "@/lib/overlays";
import {
  computeHouseSizeByModel,
  houseModelLabel,
  type HouseModelKey,
} from "@/lib/houseModels";
import { computeHistoricalEcOutcomes } from "@/lib/elections";

const DEFAULT_TOTAL = 435;
const DEFAULT_METRIC: MetricKey = "house";
const DEFAULT_RESPONSIVENESS: "low" | "medium" | "high" = "medium";
const DEFAULT_INDEPENDENT_SHARE = 0.02;
const DEFAULT_HOUSE_MODEL: HouseModelKey = "manual";
const POLLING_API_URL = "/api/polls/statewide";

type PollingApiResponse = {
  generatedAt: string;
  methodology: string;
  sourceBaseUrl: string;
  coverage: number;
  shares: Record<string, number>;
  details: Record<
    string,
    {
      share: number;
      demPct: number;
      repPct: number;
      pollster: string;
      grade: string | null;
      endDate: string;
      source: string;
    }
  >;
};

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
  const [houseModel, setHouseModel] = useState<HouseModelKey>(DEFAULT_HOUSE_MODEL);
  const [metric, setMetric] = useState<MetricKey>(DEFAULT_METRIC);
  const [darkMode, setDarkMode] = useState(true);
  const [overlaysEnabled, setOverlaysEnabled] = useState(false);
  const [responsiveness, setResponsiveness] = useState(DEFAULT_RESPONSIVENESS);
  const [independentShare, setIndependentShare] = useState(
    DEFAULT_INDEPENDENT_SHARE
  );
  const [selectedState, setSelectedState] = useState<string | null>(null);
  const [partyShares, setPartyShares] = useState<Record<string, number>>({});
  const [pollingStatus, setPollingStatus] = useState<
    "idle" | "loading" | "loaded" | "error"
  >("idle");
  const [pollingSummary, setPollingSummary] = useState<{
    coverage: number;
    generatedAt: string;
  } | null>(null);
  const [pollingError, setPollingError] = useState<string | null>(null);
  const initializedPollingRef = useRef(false);

  useEffect(() => {
    const querySeats = Number(searchParams.get("N"));
    const queryHouseModel = searchParams.get("hm") as HouseModelKey | null;
    const queryMetric = searchParams.get("metric") as MetricKey | null;
    const queryOverlays = searchParams.get("overlays");
    const queryResponsiveness = searchParams.get("resp") as
      | "low"
      | "medium"
      | "high"
      | null;
    const queryIndependentShare = Number(searchParams.get("ind"));

    if (!Number.isNaN(querySeats) && querySeats >= 435) {
      setTotalSeats(Math.min(1200, querySeats));
    }
    if (
      queryHouseModel &&
      ["manual", "cubeRoot", "proportional500k", "wyomingRule"].includes(
        queryHouseModel
      )
    ) {
      setHouseModel(queryHouseModel);
    }
    if (
      queryMetric &&
      ["house", "houseDelta", "ec", "ecDelta", "ecPerMillion"].includes(
        queryMetric
      )
    ) {
      setMetric(queryMetric);
    }
    if (queryOverlays) {
      setOverlaysEnabled(queryOverlays === "1");
    }
    if (
      queryResponsiveness &&
      ["low", "medium", "high"].includes(queryResponsiveness)
    ) {
      setResponsiveness(queryResponsiveness);
    }
    if (!Number.isNaN(queryIndependentShare)) {
      setIndependentShare(Math.min(0.2, Math.max(0, queryIndependentShare / 100)));
    }
    setPartyShares(parsePartyShares(searchParams.get("partyA"), stateData));
  }, [searchParams, stateData]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
  }, [darkMode]);

  useEffect(() => {
    if (houseModel === "manual") return;
    const computed = computeHouseSizeByModel(houseModel, stateData, totalSeats);
    if (computed !== totalSeats) {
      setTotalSeats(computed);
    }
  }, [houseModel, stateData, totalSeats]);

  useEffect(() => {
    const params = new URLSearchParams();
    params.set("N", String(totalSeats));
    params.set("hm", houseModel);
    params.set("metric", metric);
    params.set("overlays", overlaysEnabled ? "1" : "0");
    params.set("resp", responsiveness);
    params.set("ind", String(Math.round(independentShare * 100)));
    const shareString = serializePartyShares(partyShares);
    if (shareString) {
      params.set("partyA", shareString);
    }
    router.replace(`/?${params.toString()}`, { scroll: false });
  }, [
    totalSeats,
    houseModel,
    metric,
    overlaysEnabled,
    responsiveness,
    independentShare,
    partyShares,
    router,
  ]);

  const loadPollingShares = useCallback(
    async (applyToInputs: boolean) => {
      setPollingStatus("loading");
      setPollingError(null);
      try {
        const response = await fetch(POLLING_API_URL);
        if (!response.ok) {
          throw new Error("Failed to fetch statewide polling data");
        }
        const payload = (await response.json()) as PollingApiResponse;
        setPollingSummary({
          coverage: payload.coverage,
          generatedAt: payload.generatedAt,
        });
        if (applyToInputs) {
          setPartyShares((prev) => {
            const next = { ...prev };
            Object.entries(payload.shares).forEach(([abbr, share]) => {
              next[abbr] = Math.min(0.9, Math.max(0.1, share));
            });
            return next;
          });
        }
        setPollingStatus("loaded");
      } catch (error) {
        setPollingStatus("error");
        setPollingError(
          error instanceof Error ? error.message : "Polling load failed"
        );
      }
    },
    []
  );

  useEffect(() => {
    if (initializedPollingRef.current) return;
    initializedPollingRef.current = true;

    const hasPartySharesInUrl = Boolean(searchParams.get("partyA"));
    void loadPollingShares(!hasPartySharesInUrl);
  }, [loadPollingShares, searchParams]);

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

  const partisanByState = useMemo(() => {
    const map: Record<
      string,
      { democrats: number; republicans: number; independents: number }
    > = {};

    metrics.forEach((entry) => {
      const democratsShare = partyShares[entry.abbr] ?? 0.5;
      map[entry.abbr] = hamiltonThreePartyAllocation(
        entry.houseSeats,
        democratsShare,
        independentShare
      );
    });

    return map;
  }, [metrics, partyShares, independentShare]);

  const selectedMetrics = selectedState ? metricsByState[selectedState] : null;
  const selectedPartisan = selectedState ? partisanByState[selectedState] : null;

  const houseBalanceTotals = useMemo(() => {
    return Object.values(partisanByState).reduce(
      (acc, entry) => {
        acc.democrats += entry.democrats;
        acc.republicans += entry.republicans;
        acc.independents += entry.independents;
        return acc;
      },
      { democrats: 0, republicans: 0, independents: 0 }
    );
  }, [partisanByState]);

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

  const historicalEcOutcomes = useMemo(
    () => computeHistoricalEcOutcomes(metricsByState),
    [metricsByState]
  );

  const handleReset = () => {
    setTotalSeats(DEFAULT_TOTAL);
    setHouseModel(DEFAULT_HOUSE_MODEL);
    setMetric(DEFAULT_METRIC);
    setDarkMode(true);
    setOverlaysEnabled(false);
    setResponsiveness(DEFAULT_RESPONSIVENESS);
    setIndependentShare(DEFAULT_INDEPENDENT_SHARE);
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
            overlays simulate vote-to-seat translations as teaching tools, not
            forecasts.
          </p>
        </header>

        <USMap
          metricsByState={metricsByState}
          democraticShareByState={partyShares}
          partisanByState={partisanByState}
          metric={metric}
          selectedState={selectedState}
          onSelectState={setSelectedState}
        />

        <div className="mt-10 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <Controls
            totalSeats={totalSeats}
            onTotalSeatsChange={setTotalSeats}
            houseModel={houseModel}
            onHouseModelChange={setHouseModel}
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
                  <p className="text-xl font-semibold">
                    {formatNumber(totals.population)}
                  </p>
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
              <p className="label">House balance simulation</p>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Uses {houseModelLabel(houseModel)} with the current statewide
                Democratic-share inputs.
              </p>
              <div className="mt-4">
                <div className="h-5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                  <div className="flex h-full w-full">
                    <div
                      className="h-full bg-blue-500"
                      style={{
                        width: `${
                          (houseBalanceTotals.democrats / Math.max(1, totals.house)) * 100
                        }%`,
                      }}
                    />
                    <div
                      className="h-full bg-slate-400"
                      style={{
                        width: `${
                          (houseBalanceTotals.independents / Math.max(1, totals.house)) * 100
                        }%`,
                      }}
                    />
                    <div
                      className="h-full bg-red-500"
                      style={{
                        width: `${
                          (houseBalanceTotals.republicans / Math.max(1, totals.house)) * 100
                        }%`,
                      }}
                    />
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
                  <div className="rounded-lg border border-slate-200 p-2 dark:border-slate-800">
                    <p className="text-slate-500 dark:text-slate-400">Democrats</p>
                    <p className="font-semibold text-blue-600 dark:text-blue-400">
                      {houseBalanceTotals.democrats}
                    </p>
                  </div>
                  <div className="rounded-lg border border-slate-200 p-2 dark:border-slate-800">
                    <p className="text-slate-500 dark:text-slate-400">Independents</p>
                    <p className="font-semibold text-slate-700 dark:text-slate-200">
                      {houseBalanceTotals.independents}
                    </p>
                  </div>
                  <div className="rounded-lg border border-slate-200 p-2 dark:border-slate-800">
                    <p className="text-slate-500 dark:text-slate-400">Republicans</p>
                    <p className="font-semibold text-red-600 dark:text-red-400">
                      {houseBalanceTotals.republicans}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="card">
              <p className="label">Electoral College historical replay</p>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Applies each state&apos;s real 2016, 2020, and 2024 popular-vote
                winner to the current EC map. Maine and Nebraska stay split-state.
              </p>
              <div className="mt-4 space-y-4">
                {historicalEcOutcomes.map((outcome) => {
                  const ecTotal = outcome.democrats + outcome.republicans;
                  return (
                    <div key={outcome.year} className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <p className="font-semibold">{outcome.year}</p>
                        <p className="text-slate-500 dark:text-slate-400">
                          Majority {outcome.majority} | Winner{" "}
                          {outcome.winner === "D" ? "Democrats" : "Republicans"}
                        </p>
                      </div>
                      <div className="h-4 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                        <div className="flex h-full w-full">
                          <div
                            className="h-full bg-blue-500"
                            style={{
                              width: `${(outcome.democrats / Math.max(1, ecTotal)) * 100}%`,
                            }}
                          />
                          <div
                            className="h-full bg-red-500"
                            style={{
                              width: `${(outcome.republicans / Math.max(1, ecTotal)) * 100}%`,
                            }}
                          />
                        </div>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="font-semibold text-blue-600 dark:text-blue-400">
                          D {outcome.democrats}
                        </span>
                        <span className="font-semibold text-red-600 dark:text-red-400">
                          R {outcome.republicans}
                        </span>
                      </div>
                    </div>
                  );
                })}
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
                        {selectedMetrics.houseSeats} (
                        {selectedMetrics.houseDelta >= 0 ? "+" : ""}
                        {selectedMetrics.houseDelta} vs 435)
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-slate-500 dark:text-slate-400">
                        Partisan House split
                      </p>
                      <p className="text-lg font-semibold">
                        D {selectedPartisan?.democrats ?? 0} / R{" "}
                        {selectedPartisan?.republicans ?? 0} / I{" "}
                        {selectedPartisan?.independents ?? 0}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-slate-500 dark:text-slate-400">
                        Electoral College
                      </p>
                      <p className="text-lg font-semibold">
                        {selectedMetrics.ecVotes} (
                        {selectedMetrics.ecDelta >= 0 ? "+" : ""}
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
                      Seats allocated from statewide Democratic share.
                    </p>
                    <div className="mt-3 flex justify-between text-sm">
                      <span>Democrats</span>
                      <span className="font-semibold">{overlayTotals.partyA}</span>
                    </div>
                    <div className="mt-1 flex justify-between text-sm">
                      <span>Republicans</span>
                      <span className="font-semibold">{overlayTotals.partyB}</span>
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
                    <p className="text-sm font-semibold">Seat-vote curve</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Vote share adjusted by responsiveness: {responsiveness}.
                    </p>
                    <div className="mt-3 flex justify-between text-sm">
                      <span>Democrats</span>
                      <span className="font-semibold">{overlayTotals.partyACurve}</span>
                    </div>
                    <div className="mt-1 flex justify-between text-sm">
                      <span>Republicans</span>
                      <span className="font-semibold">{overlayTotals.partyBCurve}</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="mt-10">
          {overlaysEnabled ? (
            <div className="card space-y-5">
              <div>
                <p className="label">Independent baseline</p>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Applied to every state when deriving D/R/I seat splits.
                </p>
                <div className="mt-3 flex items-center gap-4">
                  <input
                    aria-label="Independent vote share baseline"
                    type="range"
                    min={0}
                    max={20}
                    value={Math.round(independentShare * 100)}
                    onChange={(event) =>
                      setIndependentShare(Number(event.target.value) / 100)
                    }
                    className="h-2 w-full cursor-pointer appearance-none rounded-full bg-slate-200 dark:bg-slate-800"
                  />
                  <span className="w-12 text-right text-sm font-semibold">
                    {Math.round(independentShare * 100)}%
                  </span>
                </div>
              </div>

              <div>
                <p className="label">Democratic vote share inputs</p>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Auto-filled from latest reputable statewide polling; adjust any
                  state manually to test scenarios.
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                  <button
                    type="button"
                    className="button"
                    onClick={() => void loadPollingShares(true)}
                    disabled={pollingStatus === "loading"}
                  >
                    {pollingStatus === "loading"
                      ? "Refreshing polling..."
                      : "Refresh from latest polls"}
                  </button>
                  {pollingStatus === "loaded" && pollingSummary && (
                    <span>
                      {pollingSummary.coverage} states updated, last fetch{" "}
                      {new Date(pollingSummary.generatedAt).toLocaleString()}.
                    </span>
                  )}
                  {pollingStatus === "error" && (
                    <span className="text-red-600 dark:text-red-400">
                      Polling fetch failed: {pollingError}
                    </span>
                  )}
                </div>
                <div className="mt-4 max-h-[420px] space-y-3 overflow-auto pr-2">
                  {metrics
                    .filter((entry) => entry.abbr !== "DC")
                    .map((entry) => (
                      <div key={entry.abbr} className="space-y-1">
                        <div className="flex items-center justify-between text-sm">
                          <span className="font-semibold">
                            {entry.state} ({entry.abbr})
                          </span>
                          <span>
                            {Math.round((partyShares[entry.abbr] ?? 0.5) * 100)}%
                          </span>
                        </div>
                        <input
                          aria-label={`Democratic vote share for ${entry.state}`}
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
            </div>
          ) : (
            <div className="card">
              <p className="label">Simulation overlays</p>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Turn on overlays to explore proportional and seat-vote curve
                simulations.
              </p>
              <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
                Current independent baseline for map partisan splits: {" "}
                <span className="font-semibold">
                  {Math.round(independentShare * 100)}%
                </span>
              </p>
              <ul className="mt-4 space-y-3 text-sm text-slate-600 dark:text-slate-300">
                <li>- Proportional-by-statewide-vote overlay (Hamilton method).</li>
                <li>- Seat-vote curve overlay (low/medium/high responsiveness).</li>
                <li>- Results are explicitly simulations, not forecasts.</li>
              </ul>
            </div>
          )}
        </div>

        <div className="mt-10">
          <StateTable rows={metrics} metric={metric} onSelectState={setSelectedState} />
        </div>
      </div>
    </main>
  );
}
