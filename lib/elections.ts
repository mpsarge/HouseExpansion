import type { StateMetrics } from "@/lib/metrics";
import { hamiltonAllocation } from "@/lib/overlays";

export type ElectionYear = 2016 | 2020 | 2024;

type Party = "D" | "R";

type ElectionConfig = {
  demWinners: string[];
  splitStates: Partial<
    Record<
      "ME" | "NE",
      {
        districtDemWins: number;
        districtCount: number;
      }
    >
  >;
};

export type ElectionOutcome = {
  year: ElectionYear;
  democrats: number;
  republicans: number;
  majority: number;
  winner: Party;
};

const ELECTIONS: Record<ElectionYear, ElectionConfig> = {
  2016: {
    demWinners: [
      "CA",
      "CO",
      "CT",
      "DC",
      "DE",
      "HI",
      "IL",
      "MA",
      "MD",
      "ME",
      "MN",
      "NH",
      "NJ",
      "NM",
      "NV",
      "NY",
      "OR",
      "RI",
      "VA",
      "VT",
      "WA",
    ],
    splitStates: {
      ME: { districtDemWins: 1, districtCount: 2 },
      NE: { districtDemWins: 0, districtCount: 3 },
    },
  },
  2020: {
    demWinners: [
      "AZ",
      "CA",
      "CO",
      "CT",
      "DC",
      "DE",
      "GA",
      "HI",
      "IL",
      "MA",
      "MD",
      "ME",
      "MI",
      "MN",
      "NH",
      "NJ",
      "NM",
      "NV",
      "NY",
      "OR",
      "PA",
      "RI",
      "VA",
      "VT",
      "WA",
      "WI",
    ],
    splitStates: {
      ME: { districtDemWins: 1, districtCount: 2 },
      NE: { districtDemWins: 1, districtCount: 3 },
    },
  },
  2024: {
    demWinners: [
      "CA",
      "CO",
      "CT",
      "DC",
      "DE",
      "HI",
      "IL",
      "MA",
      "MD",
      "ME",
      "MN",
      "NH",
      "NJ",
      "NM",
      "NY",
      "OR",
      "RI",
      "VA",
      "VT",
      "WA",
    ],
    splitStates: {
      ME: { districtDemWins: 1, districtCount: 2 },
      NE: { districtDemWins: 1, districtCount: 3 },
    },
  },
};

export const PRESIDENTIAL_DEM_WINNERS_BY_YEAR: Record<ElectionYear, string[]> = {
  2016: ELECTIONS[2016].demWinners,
  2020: ELECTIONS[2020].demWinners,
  2024: ELECTIONS[2024].demWinners,
};

const allocateSplitDistrictVotes = (
  districtVotes: number,
  districtDemWins: number,
  districtCount: number
) => {
  if (districtVotes <= 0) return { dem: 0, rep: 0 };
  if (districtCount <= 0) return { dem: 0, rep: districtVotes };
  const demShare = Math.min(1, Math.max(0, districtDemWins / districtCount));
  const allocation = hamiltonAllocation(districtVotes, demShare);
  return { dem: allocation.partyA, rep: allocation.partyB };
};

export const computeHistoricalEcOutcomes = (
  metricsByState: Record<string, StateMetrics>
): ElectionOutcome[] => {
  const ecTotal = Object.values(metricsByState).reduce(
    (sum, state) => sum + state.ecVotes,
    0
  );
  const majority = Math.floor(ecTotal / 2) + 1;

  return ([2016, 2020, 2024] as const).map((year) => {
    const config = ELECTIONS[year];
    const demWinners = new Set(config.demWinners);
    let democrats = 0;
    let republicans = 0;

    Object.entries(metricsByState).forEach(([abbr, state]) => {
      if (abbr === "ME" || abbr === "NE") {
        const split = config.splitStates[abbr];
        const districtVotes = Math.max(0, state.ecVotes - 2);
        const atLargeToDem = demWinners.has(abbr);

        if (atLargeToDem) democrats += Math.min(2, state.ecVotes);
        else republicans += Math.min(2, state.ecVotes);

        if (split) {
          const districtAllocation = allocateSplitDistrictVotes(
            districtVotes,
            split.districtDemWins,
            split.districtCount
          );
          democrats += districtAllocation.dem;
          republicans += districtAllocation.rep;
        } else if (atLargeToDem) {
          democrats += districtVotes;
        } else {
          republicans += districtVotes;
        }
        return;
      }

      if (demWinners.has(abbr)) democrats += state.ecVotes;
      else republicans += state.ecVotes;
    });

    return {
      year,
      democrats,
      republicans,
      majority,
      winner: democrats >= majority ? "D" : "R",
    };
  });
};
