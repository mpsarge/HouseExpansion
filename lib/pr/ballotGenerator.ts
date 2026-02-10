import { normalizeShares } from "./districtPlan";
import type { PartyShares } from "./types";

export type RankedBallot = {
  ranking: string[];
  weight: number;
};

export type Candidate = {
  id: string;
  partyId: string;
};

type RNG = () => number;

export const createSeededRng = (seed: number): RNG => {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
};

const chooseWeighted = (weights: Record<string, number>, rng: RNG): string => {
  const keys = Object.keys(weights);
  const roll = rng();
  let cumulative = 0;
  for (const key of keys) {
    cumulative += weights[key];
    if (roll <= cumulative) return key;
  }
  return keys[keys.length - 1];
};

const shuffle = <T>(values: T[], rng: RNG): T[] => {
  const out = [...values];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

export const buildCandidateSlate = (
  partyIds: string[],
  seats: number
): Candidate[] => {
  const perParty = Math.max(1, seats + 1);
  const out: Candidate[] = [];
  partyIds.forEach((partyId) => {
    for (let i = 1; i <= perParty; i += 1) {
      out.push({ id: `${partyId}-${i}`, partyId });
    }
  });
  return out;
};

export const generateRankedBallots = (args: {
  partyShares: PartyShares;
  partyIds: string[];
  seats: number;
  ballotCount: number;
  seed: number;
}): { ballots: RankedBallot[]; candidates: Candidate[] } => {
  const { seats, ballotCount, partyIds } = args;
  const normalized = normalizeShares(args.partyShares, partyIds);
  const candidates = buildCandidateSlate(partyIds, seats);
  const byParty: Record<string, Candidate[]> = {};
  candidates.forEach((candidate) => {
    if (!byParty[candidate.partyId]) byParty[candidate.partyId] = [];
    byParty[candidate.partyId].push(candidate);
  });

  const rng = createSeededRng(args.seed);
  const ballots: RankedBallot[] = [];

  for (let i = 0; i < ballotCount; i += 1) {
    const firstParty = chooseWeighted(normalized, rng);
    const remainingParties = shuffle(
      partyIds.filter((partyId) => partyId !== firstParty),
      rng
    );
    const partyOrder = [firstParty, ...remainingParties];
    const ranking = partyOrder.flatMap((partyId) =>
      shuffle(byParty[partyId] ?? [], rng).map((candidate) => candidate.id)
    );
    ballots.push({ ranking, weight: 1 });
  }

  return { ballots, candidates };
};
