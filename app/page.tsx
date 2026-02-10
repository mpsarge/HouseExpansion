"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Controls from "@/components/Controls";
import USMap from "@/components/USMap";
import StateTable from "@/components/StateTable";
import populations from "@/data/populations.json";
import { midtermHouseDemShareByYear } from "@/data/midtermHouseDemShare";
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
import {
  computeHistoricalEcOutcomes,
  PRESIDENTIAL_DEM_WINNERS_BY_YEAR,
} from "@/lib/elections";

const DEFAULT_TOTAL = 435;
const DEFAULT_RESPONSIVENESS: "low" | "medium" | "high" = "medium";
const DEFAULT_INDEPENDENT_SHARE = 0.02;
const DEFAULT_HOUSE_MODEL: HouseModelKey = "manual";
const AUTOMATED_HOUSE_MODELS: HouseModelKey[] = [
  "cubeRoot",
  "proportional500k",
  "wyomingRule",
];
const POLLING_API_URL = "/api/polls/statewide";
type VoteShareScenarioKey =
  | "livePolls"
  | "pres2024"
  | "pres2020"
  | "pres2016"
  | "house2022"
  | "house2018"
  | "house2014";
const DEFAULT_SCENARIO: VoteShareScenarioKey = "livePolls";

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
      shares[abbr] = clampShare(parsed);
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

const clampShare = (value: number) => Math.min(1, Math.max(0, value));

const presidentialPresetShares = (
  year: 2016 | 2020 | 2024,
  states: StatePopulation[]
) => {
  const demWinners = new Set(PRESIDENTIAL_DEM_WINNERS_BY_YEAR[year]);
  const next: Record<string, number> = {};
  states.forEach((state) => {
    if (state.abbr === "ME") {
      next[state.abbr] = year === 2016 ? 0.52 : 0.54;
      return;
    }
    if (state.abbr === "NE") {
      next[state.abbr] = year === 2016 ? 0.39 : year === 2020 ? 0.46 : 0.45;
      return;
    }
    next[state.abbr] = demWinners.has(state.abbr) ? 0.58 : 0.42;
  });
  return next;
};

const midtermPresetShares = (
  year: "2014" | "2018" | "2022",
  states: StatePopulation[]
) => {
  const source = midtermHouseDemShareByYear[year];
  const next: Record<string, number> = {};
  states.forEach((state) => {
    if (state.abbr === "DC") {
      next[state.abbr] = 0.9;
      return;
    }
    next[state.abbr] = clampShare(source[state.abbr] ?? 0.5);
  });
  return next;
};

export default function Home() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const stateData = populations as StatePopulation[];

  const [totalSeats, setTotalSeats] = useState(DEFAULT_TOTAL);
  const [houseModel, setHouseModel] = useState<HouseModelKey>(DEFAULT_HOUSE_MODEL);
  const [darkMode, setDarkMode] = useState(true);
  const [overlaysEnabled, setOverlaysEnabled] = useState(false);
  const [responsiveness, setResponsiveness] = useState(DEFAULT_RESPONSIVENESS);
  const [independentShare, setIndependentShare] = useState(
    DEFAULT_INDEPENDENT_SHARE
  );
  const [selectedState, setSelectedState] = useState<string | null>(null);
  const [partyShares, setPartyShares] = useState<Record<string, number>>({});
  const [voteShareScenario, setVoteShareScenario] =
    useState<VoteShareScenarioKey>(DEFAULT_SCENARIO);
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
    const queryOverlays = searchParams.get("overlays");
    const queryScenario = searchParams.get("scenario") as
      | VoteShareScenarioKey
      | null;
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
    if (queryOverlays) {
      setOverlaysEnabled(queryOverlays === "1");
    }
    if (
      queryScenario &&
      [
        "livePolls",
        "pres2024",
        "pres2020",
        "pres2016",
        "house2022",
        "house2018",
        "house2014",
      ].includes(queryScenario)
    ) {
      setVoteShareScenario(queryScenario);
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
    params.set("overlays", overlaysEnabled ? "1" : "0");
    params.set("scenario", voteShareScenario);
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
    overlaysEnabled,
    voteShareScenario,
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
              next[abbr] = clampShare(share);
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

  useEffect(() => {
    if (!initializedPollingRef.current) return;
    if (voteShareScenario === "livePolls") {
      void loadPollingShares(true);
      return;
    }
    if (voteShareScenario === "pres2024") {
      setPartyShares(presidentialPresetShares(2024, stateData));
      return;
    }
    if (voteShareScenario === "pres2020") {
      setPartyShares(presidentialPresetShares(2020, stateData));
      return;
    }
    if (voteShareScenario === "pres2016") {
      setPartyShares(presidentialPresetShares(2016, stateData));
      return;
    }
    if (voteShareScenario === "house2022") {
      setPartyShares(midtermPresetShares("2022", stateData));
      return;
    }
    if (voteShareScenario === "house2018") {
      setPartyShares(midtermPresetShares("2018", stateData));
      return;
    }
    setPartyShares(midtermPresetShares("2014", stateData));
  }, [voteShareScenario, stateData, loadPollingShares]);

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

  const electoralCounterTotals = useMemo(() => {
    return metrics.reduce(
      (acc, entry) => {
        const share = partyShares[entry.abbr] ?? 0.5;
        if (share <= 0.46) {
          acc.republicans += entry.ecVotes;
        } else if (share >= 0.54) {
          acc.democrats += entry.ecVotes;
        } else {
          acc.tossUp += entry.ecVotes;
        }
        return acc;
      },
      { democrats: 0, tossUp: 0, republicans: 0 }
    );
  }, [metrics, partyShares]);

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

  const overlayModelComparisons = useMemo(() => {
    const populationsByState: Record<string, number> = {};
    stateData
      .filter((state) => state.abbr !== "DC")
      .forEach((state) => {
        populationsByState[state.abbr] = state.population;
      });

    return AUTOMATED_HOUSE_MODELS.map((model) => {
      const modeledHouseSize = computeHouseSizeByModel(model, stateData, totalSeats);
      const modeledApportionment = apportion(populationsByState, modeledHouseSize);

      let proportionalD = 0;
      let proportionalR = 0;
      let curveD = 0;
      let curveR = 0;

      stateData.forEach((state) => {
        if (state.abbr === "DC") return;
        const seats = modeledApportionment[state.abbr] ?? 0;
        const share = partyShares[state.abbr] ?? 0.5;

        const proportional = hamiltonAllocation(seats, share);
        const curve = hamiltonAllocation(
          seats,
          seatShareFromVote(share, responsiveness)
        );

        proportionalD += proportional.partyA;
        proportionalR += proportional.partyB;
        curveD += curve.partyA;
        curveR += curve.partyB;
      });

      return {
        model,
        modeledHouseSize,
        proportionalD,
        proportionalR,
        curveD,
        curveR,
        deviationD: curveD - proportionalD,
        deviationR: curveR - proportionalR,
      };
    });
  }, [partyShares, responsiveness, stateData, totalSeats]);

  const historicalEcOutcomes = useMemo(
    () => computeHistoricalEcOutcomes(metricsByState),
    [metricsByState]
  );

  const handleReset = () => {
    setTotalSeats(DEFAULT_TOTAL);
    setHouseModel(DEFAULT_HOUSE_MODEL);
    setDarkMode(true);
    setOverlaysEnabled(false);
    setVoteShareScenario(DEFAULT_SCENARIO);
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
          selectedState={selectedState}
          onSelectState={setSelectedState}
        />

        <div className="mt-10 grid items-start gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <Controls
            totalSeats={totalSeats}
            onTotalSeatsChange={setTotalSeats}
            houseModel={houseModel}
            onHouseModelChange={setHouseModel}
            darkMode={darkMode}
            onToggleDarkMode={() => setDarkMode((prev) => !prev)}
            overlaysEnabled={overlaysEnabled}
            onToggleOverlays={() => setOverlaysEnabled((prev) => !prev)}
            responsiveness={responsiveness}
            onResponsivenessChange={setResponsiveness}
            onReset={handleReset}
            onShare={handleShare}
          />

          <div className="grid auto-rows-min gap-6 xl:grid-cols-2">
            <div className="card xl:col-span-2">
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
              <div className="mt-5 border-t border-slate-200 pt-5 dark:border-slate-800">
                <div className="flex items-center justify-between gap-3">
                  <p className="label">Selected state</p>
                  {selectedMetrics ? (
                    <button
                      type="button"
                      className="button"
                      onClick={() => setSelectedState(null)}
                    >
                      Clear
                    </button>
                  ) : null}
                </div>
                {selectedMetrics ? (
                  <div className="mt-3 space-y-2">
                    <h3 className="text-2xl font-semibold">
                      {selectedMetrics.state} ({selectedMetrics.abbr})
                    </h3>
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
                  <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
                    Click a state on the map or table to pin its details here.
                  </p>
                )}
              </div>
            </div>

            <div className="card xl:col-span-2">
              <p className="label">Partisan simulations</p>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Compare House balance and Electoral College counterfactuals in one
                place.
              </p>
              <div className="mt-4 space-y-6">
                <div>
                  <p className="text-sm font-semibold">House balance simulation</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Uses {houseModelLabel(houseModel)} with current statewide
                    Democratic-share inputs.
                  </p>
                  <div className="mt-3 h-5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
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
                  <div className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
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

                <div>
                  <p className="text-sm font-semibold">Electoral vote counter</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Based on current Democratic vote-share inputs. States in the
                    47-53 range are counted as toss-up.
                  </p>
                  <div className="mt-3 h-5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div className="flex h-full w-full">
                      <div
                        className="h-full bg-blue-500"
                        style={{
                          width: `${
                            (electoralCounterTotals.democrats / Math.max(1, totals.ec)) * 100
                          }%`,
                        }}
                      />
                      <div
                        className="h-full bg-slate-300 dark:bg-slate-500"
                        style={{
                          width: `${
                            (electoralCounterTotals.tossUp / Math.max(1, totals.ec)) * 100
                          }%`,
                        }}
                      />
                      <div
                        className="h-full bg-red-500"
                        style={{
                          width: `${
                            (electoralCounterTotals.republicans / Math.max(1, totals.ec)) * 100
                          }%`,
                        }}
                      />
                    </div>
                  </div>
                  <div className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
                    <div className="rounded-lg border border-slate-200 p-2 dark:border-slate-800">
                      <p className="text-slate-500 dark:text-slate-400">Democrats</p>
                      <p className="font-semibold text-blue-600 dark:text-blue-400">
                        {electoralCounterTotals.democrats}
                      </p>
                    </div>
                    <div className="rounded-lg border border-slate-200 p-2 dark:border-slate-800">
                      <p className="text-slate-500 dark:text-slate-400">Toss-up</p>
                      <p className="font-semibold text-slate-700 dark:text-slate-200">
                        {electoralCounterTotals.tossUp}
                      </p>
                    </div>
                    <div className="rounded-lg border border-slate-200 p-2 dark:border-slate-800">
                      <p className="text-slate-500 dark:text-slate-400">Republicans</p>
                      <p className="font-semibold text-red-600 dark:text-red-400">
                        {electoralCounterTotals.republicans}
                      </p>
                    </div>
                  </div>
                  <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                    Majority threshold: {Math.floor(totals.ec / 2) + 1} electoral
                    votes.
                  </p>
                </div>
              </div>
            </div>

            <div className="card xl:col-span-2">
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

          </div>
        </div>

        {overlaysEnabled && (
          <div className="mt-6 card space-y-4">
            <div>
              <p className="label">Seat-vote deviation by model</p>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Compares proportional statewide allocation to the seat-vote
                curve ({responsiveness}) for each automated House expansion
                model.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-left text-slate-500 dark:text-slate-400">
                  <tr>
                    <th className="px-2 py-2 font-medium">Model</th>
                    <th className="px-2 py-2 font-medium">House</th>
                    <th className="px-2 py-2 font-medium">Proportional (D/R)</th>
                    <th className="px-2 py-2 font-medium">Curve (D/R)</th>
                    <th className="px-2 py-2 font-medium">Delta D</th>
                    <th className="px-2 py-2 font-medium">Delta R</th>
                  </tr>
                </thead>
                <tbody>
                  {overlayModelComparisons.map((row) => (
                    <tr
                      key={row.model}
                      className="border-t border-slate-200 dark:border-slate-800"
                    >
                      <td className="px-2 py-2 font-semibold">
                        {houseModelLabel(row.model)}
                      </td>
                      <td className="px-2 py-2">{row.modeledHouseSize}</td>
                      <td className="px-2 py-2">
                        {row.proportionalD} / {row.proportionalR}
                      </td>
                      <td className="px-2 py-2">
                        {row.curveD} / {row.curveR}
                      </td>
                      <td
                        className={`px-2 py-2 font-semibold ${
                          row.deviationD > 0
                            ? "text-blue-600 dark:text-blue-400"
                            : row.deviationD < 0
                              ? "text-red-600 dark:text-red-400"
                              : ""
                        }`}
                      >
                        {row.deviationD >= 0 ? "+" : ""}
                        {row.deviationD}
                      </td>
                      <td
                        className={`px-2 py-2 font-semibold ${
                          row.deviationR > 0
                            ? "text-red-600 dark:text-red-400"
                            : row.deviationR < 0
                              ? "text-blue-600 dark:text-blue-400"
                              : ""
                        }`}
                      >
                        {row.deviationR >= 0 ? "+" : ""}
                        {row.deviationR}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Delta compares seat-vote curve seats minus proportional statewide
              seats.
            </p>
          </div>
        )}

        <div className="mt-10">
          {overlaysEnabled && (
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
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <label className="text-xs text-slate-500 dark:text-slate-400">
                    Historical view
                  </label>
                  <select
                    value={voteShareScenario}
                    onChange={(event) =>
                      setVoteShareScenario(event.target.value as VoteShareScenarioKey)
                    }
                    className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                  >
                    <option value="livePolls">Live polling baseline</option>
                    <option value="pres2024">Presidential 2024</option>
                    <option value="pres2020">Presidential 2020</option>
                    <option value="pres2016">Presidential 2016</option>
                    <option value="house2022">Congressional 2022 (midterm)</option>
                    <option value="house2018">Congressional 2018 (midterm)</option>
                    <option value="house2014">Congressional 2014 (midterm)</option>
                  </select>
                </div>
                {voteShareScenario === "house2022" ||
                voteShareScenario === "house2018" ||
                voteShareScenario === "house2014" ? (
                  <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                    Midterm presets use embedded state-level two-party U.S. House
                    vote shares for the selected year.
                  </p>
                ) : null}
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
                          min={0}
                          max={100}
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
          )}
        </div>

        <div className="mt-10">
          <StateTable rows={metrics} onSelectState={setSelectedState} />
        </div>
      </div>
    </main>
  );
}
