import { NextResponse } from "next/server";
import type { StatePopulation } from "@/lib/metrics";
import populations from "@/data/populations.json";

type PollRow = {
  state: string | null;
  pollster: string | null;
  fte_grade: string | null;
  end_date: string | null;
  candidate_party: string | null;
  pct: number | string | null;
  poll_id: string | number | null;
  question_id: string | number | null;
  partisan: string | null;
  internal: string | number | boolean | null;
};

type PollSource = {
  key: "president" | "senate" | "governor";
  table: string;
  label: string;
};

type PollGroup = {
  stateAbbr: string;
  source: PollSource["key"];
  sourceLabel: string;
  pollster: string;
  grade: string | null;
  endDate: string;
  demPct?: number;
  repPct?: number;
};

type StateResult = {
  share: number;
  demPct: number;
  repPct: number;
  pollster: string;
  grade: string | null;
  endDate: string;
  source: string;
};

const DATASETTE_ROOT = "https://fivethirtyeight.datasettes.com/polls.json";
const SOURCES: PollSource[] = [
  { key: "president", table: "president_polls", label: "President" },
  { key: "senate", table: "senate_polls", label: "Senate" },
  { key: "governor", table: "governor_polls", label: "Governor" },
];

const SQL_TEMPLATE = (table: string) => `
  select
    state,
    pollster,
    fte_grade,
    end_date,
    candidate_party,
    pct,
    poll_id,
    question_id,
    partisan,
    internal
  from ${table}
  where state is not null
    and trim(state) != ''
    and candidate_party in ('DEM', 'REP')
`;

const parseDate = (value: string) => {
  const numeric = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (numeric) {
    const month = Number(numeric[1]);
    const day = Number(numeric[2]);
    let year = Number(numeric[3]);
    if (year < 100) {
      year += year >= 70 ? 1900 : 2000;
    }
    return new Date(Date.UTC(year, month - 1, day));
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const toNumber = (value: PollRow["pct"]) => {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const isReputableRow = (row: PollRow) => {
  const grade = (row.fte_grade ?? "").trim().toUpperCase();
  if (!(grade.startsWith("A") || grade.startsWith("B"))) return false;

  const partisan = (row.partisan ?? "").trim();
  if (partisan) return false;

  const internalValue =
    typeof row.internal === "string" ? row.internal.trim().toLowerCase() : row.internal;
  if (
    internalValue === true ||
    internalValue === 1 ||
    internalValue === "1" ||
    internalValue === "true" ||
    internalValue === "yes"
  ) {
    return false;
  }
  return true;
};

const stateMaps = () => {
  const byName: Record<string, string> = {};
  const byAbbr: Record<string, string> = {};
  (populations as StatePopulation[]).forEach((state) => {
    byName[state.state.toLowerCase()] = state.abbr;
    byAbbr[state.abbr.toUpperCase()] = state.abbr;
  });
  return { byName, byAbbr };
};

const resolveStateAbbr = (
  rawState: string | null,
  maps: ReturnType<typeof stateMaps>
) => {
  if (!rawState) return null;
  const trimmed = rawState.trim();
  if (!trimmed) return null;
  if (trimmed.length === 2) {
    return maps.byAbbr[trimmed.toUpperCase()] ?? null;
  }
  return maps.byName[trimmed.toLowerCase()] ?? null;
};

const sourceWeight = (source: PollSource["key"]) => {
  if (source === "president") return 3;
  if (source === "senate") return 2;
  return 1;
};

const toStateResult = (group: PollGroup): StateResult | null => {
  if (group.demPct == null || group.repPct == null) return null;
  const twoPartyTotal = group.demPct + group.repPct;
  if (twoPartyTotal <= 0) return null;
  return {
    share: Math.max(0.1, Math.min(0.9, group.demPct / twoPartyTotal)),
    demPct: group.demPct,
    repPct: group.repPct,
    pollster: group.pollster,
    grade: group.grade,
    endDate: group.endDate,
    source: group.sourceLabel,
  };
};

export async function GET() {
  try {
    const maps = stateMaps();
    const groups = new Map<string, PollGroup>();

    for (const source of SOURCES) {
      const url = new URL(DATASETTE_ROOT);
      url.searchParams.set("sql", SQL_TEMPLATE(source.table));
      url.searchParams.set("_shape", "array");

      const response = await fetch(url.toString(), {
        next: { revalidate: 60 * 60 * 6 },
      });
      if (!response.ok) {
        throw new Error(`Polling source ${source.table} failed`);
      }

      const payload = (await response.json()) as PollRow[];
      payload.forEach((row) => {
        if (!isReputableRow(row)) return;
        const stateAbbr = resolveStateAbbr(row.state, maps);
        if (!stateAbbr) return;

        const endDate = (row.end_date ?? "").trim();
        if (!endDate) return;
        if (!parseDate(endDate)) return;

        const pct = toNumber(row.pct);
        if (pct == null) return;
        if (pct < 0 || pct > 100) return;

        const pollKey = `${source.key}:${stateAbbr}:${String(row.poll_id ?? "")}:${String(
          row.question_id ?? ""
        )}:${endDate}`;
        const existing = groups.get(pollKey);
        const base: PollGroup =
          existing ??
          ({
            stateAbbr,
            source: source.key,
            sourceLabel: source.label,
            pollster: (row.pollster ?? "Unknown").trim() || "Unknown",
            grade: row.fte_grade?.trim() || null,
            endDate,
          } satisfies PollGroup);

        if (row.candidate_party === "DEM") base.demPct = pct;
        if (row.candidate_party === "REP") base.repPct = pct;
        groups.set(pollKey, base);
      });
    }

    const byState: Record<string, StateResult> = {};
    groups.forEach((group) => {
      const parsed = toStateResult(group);
      if (!parsed) return;

      const current = byState[group.stateAbbr];
      if (!current) {
        byState[group.stateAbbr] = parsed;
        return;
      }

      const nextDate = parseDate(parsed.endDate)?.getTime() ?? 0;
      const currentDate = parseDate(current.endDate)?.getTime() ?? 0;
      if (nextDate > currentDate) {
        byState[group.stateAbbr] = parsed;
        return;
      }
      if (nextDate < currentDate) {
        return;
      }

      const nextWeight = sourceWeight(group.source);
      const currentWeight = sourceWeight(
        current.source.toLowerCase() as PollSource["key"]
      );
      if (nextWeight > currentWeight) {
        byState[group.stateAbbr] = parsed;
      }
    });

    const shares: Record<string, number> = {};
    Object.entries(byState).forEach(([abbr, result]) => {
      shares[abbr] = result.share;
    });

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      methodology:
        "Latest non-partisan, non-internal A/B-grade statewide DEM vs REP poll from FiveThirtyEight's public polls tables.",
      sourceBaseUrl: DATASETTE_ROOT,
      coverage: Object.keys(shares).length,
      shares,
      details: byState,
    });
  } catch (error) {
    return NextResponse.json(
      {
        message: "Polling data could not be loaded.",
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 502 }
    );
  }
}
