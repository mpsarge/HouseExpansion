import type { Candidate, RankedBallot } from "./ballotGenerator";

type WeightedBallot = RankedBallot & { index: number };

const droopQuota = (validVotes: number, seats: number) =>
  Math.floor(validVotes / (seats + 1)) + 1;

const activeChoice = (ballot: WeightedBallot, active: Set<string>) => {
  while (ballot.index < ballot.ranking.length) {
    const candidateId = ballot.ranking[ballot.index];
    if (active.has(candidateId)) return candidateId;
    ballot.index += 1;
  }
  return null;
};

const tally = (ballots: WeightedBallot[], active: Set<string>) => {
  const totals: Record<string, number> = {};
  active.forEach((candidateId) => {
    totals[candidateId] = 0;
  });
  ballots.forEach((ballot) => {
    const candidateId = activeChoice(ballot, active);
    if (!candidateId) return;
    totals[candidateId] += ballot.weight;
  });
  return totals;
};

const lowestCandidate = (totals: Record<string, number>) => {
  return Object.entries(totals)
    .sort((a, b) => {
      if (a[1] !== b[1]) return a[1] - b[1];
      return a[0].localeCompare(b[0]);
    })[0][0];
};

const transferSurplus = (
  winnerId: string,
  winnerTotal: number,
  quota: number,
  ballots: WeightedBallot[],
  active: Set<string>
) => {
  const surplus = winnerTotal - quota;
  if (surplus <= 0 || winnerTotal <= 0) return;
  const transferRatio = surplus / winnerTotal;

  ballots.forEach((ballot) => {
    const current = activeChoice(ballot, active);
    if (current !== winnerId) return;
    ballot.weight *= transferRatio;
    ballot.index += 1;
  });
};

export const runSTV = (args: {
  seats: number;
  candidates: Candidate[];
  ballots: RankedBallot[];
}) => {
  const { seats, candidates } = args;
  const validVotes = args.ballots.reduce((sum, ballot) => sum + ballot.weight, 0);
  const quota = droopQuota(validVotes, seats);
  const active = new Set(candidates.map((candidate) => candidate.id));
  const elected: string[] = [];
  const weightedBallots: WeightedBallot[] = args.ballots.map((ballot) => ({
    ...ballot,
    index: 0,
  }));

  while (elected.length < seats && active.size > 0) {
    if (active.size <= seats - elected.length) {
      Array.from(active)
        .sort((a, b) => a.localeCompare(b))
        .forEach((candidateId) => elected.push(candidateId));
      break;
    }

    const totals = tally(weightedBallots, active);
    const winners = Object.entries(totals)
      .filter(([, votes]) => votes >= quota)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

    if (winners.length > 0) {
      winners.forEach(([winnerId, winnerVotes]) => {
        if (!active.has(winnerId) || elected.length >= seats) return;
        elected.push(winnerId);
        transferSurplus(winnerId, winnerVotes, quota, weightedBallots, active);
        active.delete(winnerId);
      });
      continue;
    }

    const eliminated = lowestCandidate(totals);
    active.delete(eliminated);
  }

  const electedSet = new Set(elected.slice(0, seats));
  const seatsByParty: Record<string, number> = {};
  candidates.forEach((candidate) => {
    if (!seatsByParty[candidate.partyId]) seatsByParty[candidate.partyId] = 0;
    if (electedSet.has(candidate.id)) {
      seatsByParty[candidate.partyId] += 1;
    }
  });

  return {
    quota,
    electedCandidateIds: elected.slice(0, seats),
    seatsByParty,
  };
};
