"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent } from "react";
import * as d3 from "d3";
import * as topojson from "topojson-client";
import type { FeatureCollection, Feature, GeoJsonObject } from "geojson";
import type { GeometryCollection, Topology } from "topojson-specification";
import type { StateMetrics, StatePopulation } from "@/lib/metrics";
import populations from "@/data/populations.json";

const US_ATLAS_STATES_URL = "https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json";
const DISTRICTS_GEOJSON_URL = process.env.NEXT_PUBLIC_DISTRICTS_GEOJSON_URL;
const PRECINCTS_GEOJSON_TEMPLATE =
  process.env.NEXT_PUBLIC_PRECINCTS_GEOJSON_TEMPLATE;

type USMapProps = {
  metricsByState: Record<string, StateMetrics>;
  democraticShareByState?: Record<string, number>;
  partisanByState?: Record<
    string,
    { democrats: number; republicans: number; independents: number }
  >;
  selectedState?: string | null;
  onSelectState: (abbr: string) => void;
};

type SeatDeltaLabel = {
  abbr: string;
  value: string;
  x: number;
  y: number;
  anchorX?: number;
  anchorY?: number;
};

type PartisanCategory =
  | "safeR"
  | "likelyR"
  | "leanR"
  | "tossUp"
  | "leanD"
  | "likelyD"
  | "safeD";

const FORCE_CALLOUT_STATES = new Set([
  "CT",
  "DC",
  "DE",
  "HI",
  "MA",
  "MD",
  "NH",
  "NJ",
  "RI",
  "VT",
]);

const LABEL_ANCHOR_OVERRIDES: Partial<Record<string, [number, number]>> = {
  // Relative anchor inside state bounds [xFraction, yFraction].
  // These states have irregular geometry where pure centroid looks off-center.
  MI: [0.656, 0.67],
  LA: [0.336, 0.56],
  FL: [0.746, 0.37],
};

const toFeatureCollection = (geo: GeoJsonObject): FeatureCollection | null => {
  if (geo.type === "FeatureCollection") {
    return geo as FeatureCollection;
  }
  if (geo.type === "Feature") {
    return { type: "FeatureCollection", features: [geo as Feature] };
  }
  return null;
};

export default function USMap({
  metricsByState,
  democraticShareByState,
  partisanByState,
  selectedState,
  onSelectState,
}: USMapProps) {
  const [hovered, setHovered] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number } | null>(null);
  const [geo, setGeo] = useState<FeatureCollection | null>(null);
  const [districtsGeo, setDistrictsGeo] = useState<FeatureCollection | null>(null);
  const [precinctsGeo, setPrecinctsGeo] = useState<FeatureCollection | null>(null);
  const [showDistricts, setShowDistricts] = useState(false);
  const [showPrecincts, setShowPrecincts] = useState(false);
  const [districtStatus, setDistrictStatus] = useState<string | null>(null);
  const [precinctStatus, setPrecinctStatus] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const hasDistrictSource = Boolean(DISTRICTS_GEOJSON_URL?.trim());
  const hasPrecinctSource = Boolean(PRECINCTS_GEOJSON_TEMPLATE?.trim());

  const fipsToAbbr = useMemo(() => {
    const map: Record<string, string> = {};
    (populations as StatePopulation[]).forEach((state) => {
      map[state.fips.padStart(2, "0")] = state.abbr;
    });
    return map;
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadGeo = async () => {
      try {
        const response = await fetch(US_ATLAS_STATES_URL);
        if (!response.ok) {
          throw new Error("Failed to load geographic boundaries");
        }

        const atlas = (await response.json()) as Topology<{
          states: GeometryCollection;
        }>;
        const statesGeo = topojson.feature(atlas, atlas.objects.states);
        const featureCollection = toFeatureCollection(statesGeo);
        if (!featureCollection) {
          throw new Error("Unexpected states geometry format");
        }

        const withAbbr = (featureCollection.features as Feature[])
          .map((feature) => {
            const fips = String(
              (feature as { id?: string | number }).id ?? ""
            ).padStart(2, "0");
            const abbr = fipsToAbbr[fips];
            if (!abbr) return null;
            return {
              ...feature,
              properties: { ...(feature.properties ?? {}), abbr },
            } as Feature;
          })
          .filter((feature): feature is Feature => feature !== null);

        if (!cancelled) {
          setGeo({ type: "FeatureCollection", features: withAbbr });
        }
      } catch {
        if (!cancelled) {
          setGeo({ type: "FeatureCollection", features: [] });
        }
      }
    };

    loadGeo();

    return () => {
      cancelled = true;
    };
  }, [fipsToAbbr]);

  useEffect(() => {
    if (!showDistricts) {
      setDistrictStatus(null);
      return;
    }
    if (!hasDistrictSource) {
      setDistrictStatus(
        "District layer unavailable. Set NEXT_PUBLIC_DISTRICTS_GEOJSON_URL."
      );
      return;
    }

    let cancelled = false;
    setDistrictStatus("Loading congressional district borders...");

    const loadDistricts = async () => {
      try {
        const response = await fetch(DISTRICTS_GEOJSON_URL as string);
        if (!response.ok) {
          throw new Error("Could not load district GeoJSON");
        }
        const raw = (await response.json()) as GeoJsonObject;
        const asCollection = toFeatureCollection(raw);
        if (!asCollection) {
          throw new Error("Unsupported district geometry format");
        }
        if (!cancelled) {
          setDistrictsGeo(asCollection);
          setDistrictStatus(null);
        }
      } catch {
        if (!cancelled) {
          setDistrictsGeo(null);
          setDistrictStatus("District layer failed to load.");
        }
      }
    };

    loadDistricts();

    return () => {
      cancelled = true;
    };
  }, [showDistricts, hasDistrictSource]);

  useEffect(() => {
    if (!showPrecincts) {
      setPrecinctsGeo(null);
      setPrecinctStatus(null);
      return;
    }
    if (!selectedState) {
      setPrecinctsGeo(null);
      setPrecinctStatus("Select a state to load precinct borders.");
      return;
    }
    if (!hasPrecinctSource) {
      setPrecinctStatus(
        "Precinct layer unavailable. Set NEXT_PUBLIC_PRECINCTS_GEOJSON_TEMPLATE."
      );
      return;
    }

    const sourceUrl = (PRECINCTS_GEOJSON_TEMPLATE as string).replace(
      "{state}",
      selectedState.toUpperCase()
    );

    let cancelled = false;
    setPrecinctStatus(`Loading precinct borders for ${selectedState}...`);

    const loadPrecincts = async () => {
      try {
        const response = await fetch(sourceUrl);
        if (!response.ok) {
          throw new Error("Could not load precinct GeoJSON");
        }
        const raw = (await response.json()) as GeoJsonObject;
        const asCollection = toFeatureCollection(raw);
        if (!asCollection) {
          throw new Error("Unsupported precinct geometry format");
        }
        if (!cancelled) {
          setPrecinctsGeo(asCollection);
          setPrecinctStatus(null);
        }
      } catch {
        if (!cancelled) {
          setPrecinctsGeo(null);
          setPrecinctStatus(
            `Precinct layer failed to load for ${selectedState}.`
          );
        }
      }
    };

    loadPrecincts();

    return () => {
      cancelled = true;
    };
  }, [selectedState, showPrecincts, hasPrecinctSource]);

  const width = 1100;
  const height = 620;
  const path = useMemo(() => {
    if (!geo) return null;
    const projection = d3.geoAlbersUsa().fitSize([width, height], geo);
    return d3.geoPath().projection(projection);
  }, [geo]);
  const hasSeatExpansion = useMemo(
    () => Object.values(metricsByState).some((entry) => entry.houseDelta !== 0),
    [metricsByState]
  );
  const seatDeltaLabels = useMemo(() => {
    if (!geo || !path || !hasSeatExpansion) return [] as SeatDeltaLabel[];

    const inline: SeatDeltaLabel[] = [];
    const callouts: SeatDeltaLabel[] = [];
    const minWidth = 26;
    const minHeight = 18;
    const minArea = 520;

    (geo.features as Feature[]).forEach((feature) => {
      const abbr = (feature.properties as { abbr?: string })?.abbr;
      if (!abbr) return;
      const data = metricsByState[abbr];
      if (!data) return;

      const bounds = path.bounds(feature);
      const centroid = path.centroid(feature);
      if (!Number.isFinite(centroid[0]) || !Number.isFinite(centroid[1])) {
        return;
      }
      const override = LABEL_ANCHOR_OVERRIDES[abbr];
      const anchorX = override
        ? bounds[0][0] + (bounds[1][0] - bounds[0][0]) * override[0]
        : centroid[0];
      const anchorY = override
        ? bounds[0][1] + (bounds[1][1] - bounds[0][1]) * override[1]
        : centroid[1];
      const featureWidth = bounds[1][0] - bounds[0][0];
      const featureHeight = bounds[1][1] - bounds[0][1];
      const featureArea = featureWidth * featureHeight;
      const value = data.houseDelta > 0 ? `+${data.houseDelta}` : "0";
      const useCallout =
        FORCE_CALLOUT_STATES.has(abbr) ||
        featureWidth < minWidth ||
        featureHeight < minHeight ||
        featureArea < minArea;

      if (useCallout) {
        callouts.push({
          abbr,
          value,
          x: Math.min(width - 20, bounds[1][0] + 16),
          y: Math.max(16, Math.min(height - 16, anchorY)),
          anchorX,
          anchorY,
        });
      } else {
        inline.push({
          abbr,
          value,
          x: anchorX,
          y: anchorY,
        });
      }
    });

    // Avoid overlapping callouts by enforcing vertical spacing in Y order.
    const minGap = 18;
    callouts.sort((a, b) => a.y - b.y);
    for (let i = 1; i < callouts.length; i += 1) {
      callouts[i].y = Math.max(callouts[i].y, callouts[i - 1].y + minGap);
    }
    for (let i = callouts.length - 2; i >= 0; i -= 1) {
      callouts[i].y = Math.min(callouts[i].y, callouts[i + 1].y - minGap);
    }
    callouts.forEach((label) => {
      label.y = Math.max(14, Math.min(height - 14, label.y));
    });

    return [...inline, ...callouts];
  }, [geo, path, hasSeatExpansion, metricsByState]);

  const updateTooltip = (event: MouseEvent<SVGPathElement>) => {
    const bounds = containerRef.current?.getBoundingClientRect();
    if (!bounds) return;
    setTooltip({ x: event.clientX - bounds.left, y: event.clientY - bounds.top });
  };

  const categoryForShare = (share: number): PartisanCategory => {
    const pct = Math.round(Math.max(0, Math.min(1, share)) * 100);
    if (pct <= 37) return "safeR";
    if (pct <= 42) return "likelyR";
    if (pct <= 46) return "leanR";
    if (pct <= 53) return "tossUp";
    if (pct <= 56) return "leanD";
    if (pct <= 60) return "likelyD";
    return "safeD";
  };

  const categoryLabel = (category: PartisanCategory) => {
    if (category === "safeR") return "Safe Republican";
    if (category === "likelyR") return "Likely Republican";
    if (category === "leanR") return "Lean Republican";
    if (category === "tossUp") return "Toss-Up";
    if (category === "leanD") return "Lean Democratic";
    if (category === "likelyD") return "Likely Democratic";
    return "Safe Democratic";
  };

  const categoryClassName = (category: PartisanCategory) => {
    if (category === "safeR") return "fill-red-700 dark:fill-red-800";
    if (category === "likelyR") return "fill-red-600 dark:fill-red-700";
    if (category === "leanR") return "fill-red-400 dark:fill-red-500";
    if (category === "tossUp") return "fill-slate-100 dark:fill-slate-900";
    if (category === "leanD") return "fill-blue-400 dark:fill-blue-500";
    if (category === "likelyD") return "fill-blue-600 dark:fill-blue-700";
    return "fill-blue-800 dark:fill-blue-900";
  };

  return (
    <div ref={containerRef} className="card relative">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="label">Geographic map</p>
          <h3 className="text-lg font-semibold">United States by state</h3>
        </div>
        <div className="space-y-1 text-xs text-slate-500 dark:text-slate-400">
          <p>Click a state to pin details</p>
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={showDistricts}
                disabled={!hasDistrictSource}
                onChange={() => setShowDistricts((prev) => !prev)}
                title={
                  hasDistrictSource
                    ? "Toggle congressional district borders"
                    : "Set NEXT_PUBLIC_DISTRICTS_GEOJSON_URL to enable"
                }
              />
              <span className={!hasDistrictSource ? "opacity-60" : undefined}>
                District borders
              </span>
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={showPrecincts}
                disabled={!hasPrecinctSource}
                onChange={() => setShowPrecincts((prev) => !prev)}
                title={
                  hasPrecinctSource
                    ? "Toggle precinct borders"
                    : "Set NEXT_PUBLIC_PRECINCTS_GEOJSON_TEMPLATE to enable"
                }
              />
              <span className={!hasPrecinctSource ? "opacity-60" : undefined}>
                Precinct borders
              </span>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 pt-1">
            {(
              [
                "safeR",
                "likelyR",
                "leanR",
                "tossUp",
                "leanD",
                "likelyD",
                "safeD",
              ] as PartisanCategory[]
            ).map((category) => (
              <div key={category} className="flex items-center gap-2">
                <span
                  className={`inline-block h-2.5 w-2.5 rounded-sm border border-slate-300 dark:border-slate-700 ${categoryClassName(
                    category
                  )}`}
                />
                <span>{categoryLabel(category)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {(!hasDistrictSource || !hasPrecinctSource) && (
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          Set NEXT_PUBLIC_DISTRICTS_GEOJSON_URL and
          NEXT_PUBLIC_PRECINCTS_GEOJSON_TEMPLATE in .env.local to enable advanced
          border overlays.
        </p>
      )}

      {(districtStatus || precinctStatus) && (
        <div className="mt-3 space-y-1 text-xs text-slate-500 dark:text-slate-400">
          {districtStatus && <p>{districtStatus}</p>}
          {precinctStatus && <p>{precinctStatus}</p>}
        </div>
      )}

      {!geo && (
        <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">
          Loading geographic boundaries...
        </p>
      )}

      {geo && geo.features.length === 0 && (
        <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">
          Geographic map data could not be loaded in this environment.
        </p>
      )}

      <svg
        className="mt-4 h-auto w-full"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Map of the United States by state"
      >
        {(geo?.features as Feature[] | undefined)?.map((feature) => {
          if (!path) return null;
          const abbr = (feature.properties as { abbr?: string })?.abbr;
          if (!abbr) return null;
          const data = metricsByState[abbr];
          if (!data) return null;
          const demShare = democraticShareByState?.[abbr] ?? 0.5;
          const category = categoryForShare(demShare);
          const isSelected = selectedState === abbr;
          const isHovered = hovered === abbr;
          return (
            <path
              key={abbr}
              d={path(feature) ?? undefined}
              stroke={isSelected ? "#f97316" : undefined}
              strokeWidth={isSelected ? 2.5 : 1}
              className={`cursor-pointer transition-all ${
                isSelected || isHovered
                  ? "fill-sky-200 dark:fill-sky-900/60"
                  : categoryClassName(category)
              } ${
                isSelected
                  ? "stroke-orange-400"
                  : "stroke-slate-400 dark:stroke-slate-600"
              }`}
              tabIndex={0}
              onMouseEnter={(event) => {
                setHovered(abbr);
                updateTooltip(event);
              }}
              onMouseMove={updateTooltip}
              onMouseLeave={() => {
                setHovered(null);
                setTooltip(null);
              }}
              onFocus={() => setHovered(abbr)}
              onBlur={() => setHovered(null)}
              onClick={() => onSelectState(abbr)}
              aria-label={data.state}
            />
          );
        })}

        {showDistricts && path &&
          (districtsGeo?.features as Feature[] | undefined)?.map((feature, idx) => (
            <path
              key={`district-${idx}`}
              d={path(feature) ?? undefined}
              fill="none"
              stroke="#475569"
              strokeOpacity={0.55}
              strokeWidth={0.7}
              vectorEffect="non-scaling-stroke"
            />
          ))}

        {showPrecincts && path &&
          (precinctsGeo?.features as Feature[] | undefined)?.map((feature, idx) => (
            <path
              key={`precinct-${idx}`}
              d={path(feature) ?? undefined}
              fill="none"
              stroke="#94a3b8"
              strokeOpacity={0.55}
              strokeWidth={0.35}
              vectorEffect="non-scaling-stroke"
            />
          ))}

        {seatDeltaLabels.map((label) => {
          const isCallout =
            typeof label.anchorX === "number" && typeof label.anchorY === "number";

          if (!isCallout) {
            return (
              <text
                key={`seat-delta-${label.abbr}`}
                x={label.x}
                y={label.y}
                textAnchor="middle"
                dominantBaseline="middle"
                textRendering="geometricPrecision"
                className="pointer-events-none fill-slate-900 text-[11px] font-semibold dark:fill-slate-100"
                style={{
                  paintOrder: "stroke",
                  stroke: "rgba(248, 250, 252, 0.95)",
                  strokeWidth: 1.2,
                  strokeLinejoin: "round",
                  strokeLinecap: "round",
                }}
              >
                {label.value}
              </text>
            );
          }

          const textWidth = Math.max(18, label.value.length * 8);
          const boxHeight = 14;
          const boxX = label.x - textWidth / 2 - 3;
          const boxY = label.y - boxHeight / 2;

          return (
            <g key={`seat-delta-${label.abbr}`} className="pointer-events-none">
              <line
                x1={label.anchorX}
                y1={label.anchorY}
                x2={label.x - textWidth / 2 - 5}
                y2={label.y}
                stroke="#475569"
                strokeWidth={1}
              />
              <rect
                x={boxX}
                y={boxY}
                width={textWidth + 6}
                height={boxHeight}
                rx={4}
                fill="rgba(255,255,255,0.95)"
                stroke="#94a3b8"
                strokeWidth={1}
              />
              <text
                x={label.x}
                y={label.y}
                textAnchor="middle"
                dominantBaseline="middle"
                className="fill-slate-900 text-[10px] font-semibold"
              >
                {label.value}
              </text>
            </g>
          );
        })}
      </svg>

      {hovered && tooltip && metricsByState[hovered] && (
        <div
          className="pointer-events-none absolute rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 shadow-md dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
          style={{ left: tooltip.x + 12, top: tooltip.y - 12 }}
        >
          <p className="font-semibold">{metricsByState[hovered].state}</p>
          <p>House: {metricsByState[hovered].houseSeats}</p>
          <p>Delta House: {metricsByState[hovered].houseDelta}</p>
          <p>EC: {metricsByState[hovered].ecVotes}</p>
          <p>Delta EC: {metricsByState[hovered].ecDelta}</p>
          <p>
            EC / M: {metricsByState[hovered].ecPerMillion.toFixed(2)}
          </p>
          <p>
            Category:{" "}
            {categoryLabel(
              categoryForShare(democraticShareByState?.[hovered] ?? 0.5)
            )}
          </p>
          {partisanByState?.[hovered] && (
            <div className="mt-1 border-t border-slate-200 pt-1 dark:border-slate-700">
              <p>D: {partisanByState[hovered].democrats}</p>
              <p>R: {partisanByState[hovered].republicans}</p>
              <p>I: {partisanByState[hovered].independents}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
