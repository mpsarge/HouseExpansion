"use client";

import type { StateMetrics } from "@/lib/metrics";
import type { MetricKey } from "@/components/Controls";
import { formatNumber } from "@/lib/metrics";

const metricLabels: Record<MetricKey, string> = {
  house: "House",
  houseDelta: "Delta House",
  ec: "EC",
  ecDelta: "Delta EC",
  ecPerMillion: "EC / M",
};

type StateTableProps = {
  rows: StateMetrics[];
  metric: MetricKey;
  onSelectState: (abbr: string) => void;
};

const metricValue = (row: StateMetrics, metric: MetricKey) => {
  if (metric === "house") return row.houseSeats;
  if (metric === "ec") return row.ecVotes;
  if (metric === "houseDelta") return row.houseDelta;
  if (metric === "ecDelta") return row.ecDelta;
  return row.ecPerMillion;
};

export default function StateTable({
  rows,
  metric,
  onSelectState,
}: StateTableProps) {
  const sorted = [...rows].sort((a, b) => {
    const valueA = metricValue(a, metric);
    const valueB = metricValue(b, metric);
    if (valueA === valueB) return a.state.localeCompare(b.state);
    return valueB - valueA;
  });

  return (
    <div className="card">
      <div className="flex items-center justify-between">
        <div>
          <p className="label">State table</p>
          <h3 className="text-lg font-semibold">Sorted by {metricLabels[metric]}</h3>
        </div>
      </div>
      <div className="mt-4 overflow-auto">
        <table className="min-w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400">
            <tr>
              <th className="py-2 pr-4">State</th>
              <th className="py-2 pr-4">Population</th>
              <th className="py-2 pr-4">House</th>
              <th className="py-2 pr-4">Delta House</th>
              <th className="py-2 pr-4">EC</th>
              <th className="py-2 pr-4">Delta EC</th>
              <th className="py-2 pr-4">EC / M</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 text-slate-700 dark:divide-slate-800 dark:text-slate-200">
            {sorted.map((row) => (
              <tr
                key={row.abbr}
                className="cursor-pointer transition hover:bg-slate-50 dark:hover:bg-slate-800/60"
                onClick={() => onSelectState(row.abbr)}
              >
                <td className="py-2 pr-4 font-semibold">
                  {row.state} ({row.abbr})
                </td>
                <td className="py-2 pr-4">{formatNumber(row.population)}</td>
                <td className="py-2 pr-4">{row.houseSeats}</td>
                <td className="py-2 pr-4">{row.houseDelta}</td>
                <td className="py-2 pr-4">{row.ecVotes}</td>
                <td className="py-2 pr-4">{row.ecDelta}</td>
                <td className="py-2 pr-4">{formatNumber(row.ecPerMillion, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

