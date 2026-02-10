import { buildDistrictPlan, clampPRSettings, normalizeShares } from "./districtPlan";
import { buildCandidateSlate, createSeededRng, generateRankedBallots } from "./ballotGenerator";
import { gallagherIndex, sharesFromSeats, wastedVotesProxy } from "./metrics";
import { runSTV } from "./stv";
import { allocateTopUpSeats } from "./topup";
import type {
  DistrictPlan,
  Party,
  PartySeatResult,
  PRSettings,
  StatePRResult,
  StateVotes,
} from "./types";

type RunArgs = {
  parties: Party[];
  states: StateVotes[];
  stateSeats: Record<string, number>;
  settings: PRSettings;
  districtOverrides?: Record<string, DistrictPlan>;
};

const stateCache = new Map<string, StatePRResult>();

const cacheKey = (args: {
  stateCode: string;
  stateSeats: number;
  voteShares: Record<string, number>;
  settings: PRSettings;
  districtPlan: DistrictPlan;
  partyIds: string[];
}) =>
  JSON.stringify({
    s: args.stateCode,
    seats: args.stateSeats,
    votes: args.voteShares,
    set: args.settings,
    plan: args.districtPlan,
    parties: args.partyIds,
  });

const initSeatMap = (partyIds: string[]) =>
  partyIds.reduce(
    (acc, partyId) => {
      acc[partyId] = 0;
      return acc;
    },
    {} as PartySeatResult
  );

const mergeSeats = (target: PartySeatResult, add: PartySeatResult) => {
  Object.entries(add).forEach(([partyId, seats]) => {
    target[partyId] = (target[partyId] ?? 0) + seats;
  });
};

export const runHybridPRByState = (args: RunArgs): StatePRResult[] => {
  const safeSettings = clampPRSettings(args.settings);
  const partyIds = args.parties.map((party) => party.id);

  return args.states.map((stateVote) => {
    const stateCode = stateVote.stateCode;
    const totalSeats = Math.max(0, args.stateSeats[stateCode] ?? 0);
    const voteShares = normalizeShares(stateVote.partyShares, partyIds);
    const topUpSeats = safeSettings.useTopUp
      ? Math.min(totalSeats, Math.round(totalSeats * safeSettings.topUpSeatShare))
      : 0;
    const districtSeatTotal = Math.max(0, totalSeats - topUpSeats);
    const districtPlan =
      args.districtOverrides?.[stateCode] ??
      buildDistrictPlan(stateCode, districtSeatTotal, safeSettings);

    const key = cacheKey({
      stateCode,
      stateSeats: totalSeats,
      voteShares,
      settings: safeSettings,
      districtPlan,
      partyIds,
    });
    const cached = stateCache.get(key);
    if (cached) return cached;

    const districtSeatsByParty = initSeatMap(partyIds);
    const stateSeedBase =
      safeSettings.randomSeed +
      stateCode.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
    const districtSeedRng = createSeededRng(stateSeedBase);

    districtPlan.districts.forEach((district) => {
      const seats = Math.max(1, district.seats);
      const districtShares = normalizeShares(
        district.partyShares ?? voteShares,
        partyIds
      );
      const ballotCount = Math.max(100, safeSettings.stvBallotsPerSeat * seats);
      const ballotSeed = Math.floor(districtSeedRng() * 1_000_000_000);

      const { ballots, candidates } = generateRankedBallots({
        partyShares: districtShares,
        partyIds,
        seats,
        ballotCount,
        seed: ballotSeed,
      });
      const result = runSTV({
        seats,
        ballots,
        candidates: candidates.length > 0 ? candidates : buildCandidateSlate(partyIds, seats),
      });
      mergeSeats(districtSeatsByParty, result.seatsByParty);
    });

    let finalSeatsByParty = { ...districtSeatsByParty };
    if (safeSettings.useTopUp && topUpSeats > 0) {
      const topUp = allocateTopUpSeats({
        partyIds,
        totalSeats,
        topUpSeats,
        voteShares,
        districtSeatsByParty,
      });
      finalSeatsByParty = topUp.finalSeatsByParty;
    }

    const seatShares = sharesFromSeats(finalSeatsByParty, partyIds);
    const stateResult: StatePRResult = {
      stateCode,
      totalSeats,
      districtSeats: districtSeatTotal,
      topUpSeats,
      voteShares,
      districtSeatsByParty,
      finalSeatsByParty,
      gallagher: gallagherIndex({
        voteShares,
        seatShares,
        partyIds,
      }),
      wastedVotesProxy: wastedVotesProxy({
        voteShares,
        seatShares,
        partyIds,
      }),
      districtPlan,
    };
    stateCache.set(key, stateResult);
    return stateResult;
  });
};

export const summarizeNationalPR = (
  results: StatePRResult[],
  parties: Party[]
) => {
  const partyIds = parties.map((party) => party.id);
  const totalSeatsByParty = initSeatMap(partyIds);
  const totalVotesByParty = partyIds.reduce(
    (acc, partyId) => {
      acc[partyId] = 0;
      return acc;
    },
    {} as Record<string, number>
  );
  let totalSeats = 0;

  results.forEach((state) => {
    totalSeats += state.totalSeats;
    partyIds.forEach((partyId) => {
      totalSeatsByParty[partyId] += state.finalSeatsByParty[partyId] ?? 0;
      totalVotesByParty[partyId] += (state.voteShares[partyId] ?? 0) * state.totalSeats;
    });
  });

  if (totalSeats > 0) {
    partyIds.forEach((partyId) => {
      totalVotesByParty[partyId] /= totalSeats;
    });
  }

  const seatShares = sharesFromSeats(totalSeatsByParty, partyIds);
  return {
    totalSeatsByParty,
    totalVotesByParty,
    gallagher: gallagherIndex({
      voteShares: totalVotesByParty,
      seatShares,
      partyIds,
    }),
    wastedVotesProxy: wastedVotesProxy({
      voteShares: totalVotesByParty,
      seatShares,
      partyIds,
    }),
  };
};
