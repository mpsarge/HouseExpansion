"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent } from "react";
import * as d3 from "d3";
import * as topojson from "topojson-client";
import type { FeatureCollection, Feature } from "geojson";
import type { MetricKey } from "@/components/Controls";
import type { StateMetrics, StatePopulation } from "@/lib/metrics";
import populations from "@/data/populations.json";

const US_ATLAS_STATES_URL = "https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json";

const metricAccessor = (metric: MetricKey, data: StateMetrics) => {
  if (metric === "house") return data.houseSeats;
  if (metric === "ec") return data.ecVotes;
  if (metric === "houseDelta") return data.houseDelta;
  if (metric === "ecDelta") return data.ecDelta;
  return data.ecPerMillion;
};

type USMapProps = {
  metricsByState: Record<string, StateMetrics>;
  metric: MetricKey;
  selectedState?: string | null;
  onSelectState: (abbr: string) => void;
};

export default function USMap({
  metricsByState,
  metric,
  selectedState,
  onSelectState,
}: USMapProps) {
  const [hovered, setHovered] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number } | null>(null);
  const [geo, setGeo] = useState<FeatureCollection | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

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
            const fips = String((feature as { id?: string | number }).id ?? "").padStart(2, "0");
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

  const width = 700;
  const height = 420;
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
      <div className="flex items-center justify-between">
        <div>
          <p className="label">Geographic map</p>
          <h3 className="text-lg font-semibold">United States by state</h3>
        </div>
        <div className="text-xs text-slate-500 dark:text-slate-400">
          Click a state to pin details
        </div>
      </div>

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
              } ${isSelected ? "stroke-orange-400" : "stroke-slate-400 dark:stroke-slate-600"}`}
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
        </div>
      )}
    </div>
  );
}
