"use client";

import { useMemo, useRef, useState } from "react";
import type { MouseEvent } from "react";
import * as d3 from "d3";
import * as topojson from "topojson-client";
import type { FeatureCollection, Feature } from "geojson";
import type { MetricKey } from "@/components/Controls";
import type { StateMetrics } from "@/lib/metrics";
import topology from "@/data/us-tile-topo.json";

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
  const [tooltip, setTooltip] = useState<{ x: number; y: number } | null>(
    null
  );
  const containerRef = useRef<HTMLDivElement | null>(null);

  const geo = useMemo(() => {
    const featureCollection = topojson.feature(
      topology as unknown as topojson.Topology,
      (topology as { objects: { states: topojson.GeometryCollection } }).objects
        .states
    ) as FeatureCollection;
    return featureCollection;
  }, []);

  const values = Object.values(metricsByState).map((data) =>
    metricAccessor(metric, data)
  );
  const min = Math.min(...values);
  const max = Math.max(...values);
  const scale = d3
    .scaleQuantize<string>()
    .domain([min, max])
    .range([
      "#e0e7ff",
      "#c7d2fe",
      "#a5b4fc",
      "#818cf8",
      "#6366f1",
      "#4f46e5",
      "#4338ca",
    ]);

  const width = 700;
  const height = 420;
  const path = d3
    .geoPath()
    .projection(
      d3.geoIdentity().reflectY(true).fitSize([width, height], geo)
    );

  const updateTooltip = (event: MouseEvent<SVGPathElement>) => {
    const bounds = containerRef.current?.getBoundingClientRect();
    if (!bounds) return;
    setTooltip({ x: event.clientX - bounds.left, y: event.clientY - bounds.top });
  };

  return (
    <div ref={containerRef} className="card relative">
      <div className="flex items-center justify-between">
        <div>
          <p className="label">Choropleth map</p>
          <h3 className="text-lg font-semibold">State-by-state metric map</h3>
        </div>
        <div className="text-xs text-slate-500 dark:text-slate-400">
          Tile map (schematic)
        </div>
      </div>
      <svg
        className="mt-4 h-auto w-full"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Map of the United States by state"
      >
        {(geo.features as Feature[]).map((feature) => {
          const abbr = (feature.properties as { abbr?: string })?.abbr;
          if (!abbr) return null;
          const data = metricsByState[abbr];
          if (!data) return null;
          const value = metricAccessor(metric, data);
          const fill = scale(value);
          const isSelected = selectedState === abbr;
          const isHovered = hovered === abbr;
          return (
            <path
              key={abbr}
              d={path(feature) ?? undefined}
              fill={fill}
              stroke={isSelected ? "#f97316" : "#0f172a"}
              strokeWidth={isSelected ? 3 : 1}
              className="cursor-pointer transition-all"
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
              aria-label={`${data.state}`}
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
            {metric === "houseDelta" && "Δ House"}
            {metric === "ec" && "EC"}
            {metric === "ecDelta" && "Δ EC"}
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
