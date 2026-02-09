"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent } from "react";
import * as d3 from "d3";
import * as topojson from "topojson-client";
import type { FeatureCollection, Feature, GeoJsonObject } from "geojson";
import type { MetricKey } from "@/components/Controls";
import type { StateMetrics, StatePopulation } from "@/lib/metrics";
import populations from "@/data/populations.json";

const US_ATLAS_STATES_URL = "https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json";
const DISTRICTS_GEOJSON_URL = process.env.NEXT_PUBLIC_DISTRICTS_GEOJSON_URL;
const PRECINCTS_GEOJSON_TEMPLATE =
  process.env.NEXT_PUBLIC_PRECINCTS_GEOJSON_TEMPLATE;

const metricAccessor = (metric: MetricKey, data: StateMetrics) => {
  if (metric === "house") return data.houseSeats;
  if (metric === "ec") return data.ecVotes;
  if (metric === "houseDelta") return data.houseDelta;
  if (metric === "ecDelta") return data.ecDelta;
  return data.ecPerMillion;
};

type USMapProps = {
  metricsByState: Record<string, StateMetrics>;
  partisanByState?: Record<
    string,
    { democrats: number; republicans: number; independents: number }
  >;
  metric: MetricKey;
  selectedState?: string | null;
  onSelectState: (abbr: string) => void;
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
  partisanByState,
  metric,
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

        const atlas = await response.json();
        const featureCollection = topojson.feature(
          atlas as unknown as topojson.Topology,
          (atlas as { objects: { states: topojson.GeometryCollection } }).objects
            .states
        ) as FeatureCollection;

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

  const updateTooltip = (event: MouseEvent<SVGPathElement>) => {
    const bounds = containerRef.current?.getBoundingClientRect();
    if (!bounds) return;
    setTooltip({ x: event.clientX - bounds.left, y: event.clientY - bounds.top });
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
                  : "fill-slate-200 dark:fill-slate-800"
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
      </svg>

      {hovered && tooltip && metricsByState[hovered] && (
        <div
          className="pointer-events-none absolute rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 shadow-md dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
          style={{ left: tooltip.x + 12, top: tooltip.y - 12 }}
        >
          <p className="font-semibold">{metricsByState[hovered].state}</p>
          <p>
            {metric === "house" && "House"}
            {metric === "houseDelta" && "Delta House"}
            {metric === "ec" && "EC"}
            {metric === "ecDelta" && "Delta EC"}
            {metric === "ecPerMillion" && "EC / M"}: {" "}
            {metricAccessor(metric, metricsByState[hovered]).toFixed(
              metric === "ecPerMillion" ? 2 : 0
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
