import { normalizeShares } from "./districtPlan";
import type { PartySeatResult, PartyShares } from "./types";

export const sharesFromSeats = (
  seatsByParty: PartySeatResult,
  partyIds: string[]
): PartyShares => {
  const totalSeats = partyIds.reduce(
    (sum, partyId) => sum + (seatsByParty[partyId] ?? 0),
    0
  );
  if (totalSeats <= 0) {
    return normalizeShares({}, partyIds);
  }

  const out: PartyShares = {};
  partyIds.forEach((partyId) => {
    out[partyId] = (seatsByParty[partyId] ?? 0) / totalSeats;
  });
  return out;
};

export const gallagherIndex = (args: {
  voteShares: PartyShares;
  seatShares: PartyShares;
  partyIds: string[];
}) => {
  const votes = normalizeShares(args.voteShares, args.partyIds);
  const seats = normalizeShares(args.seatShares, args.partyIds);
  const sumSquares = args.partyIds.reduce((sum, partyId) => {
    return sum + (seats[partyId] - votes[partyId]) ** 2;
  }, 0);
  return Math.sqrt(0.5 * sumSquares);
};

export const wastedVotesProxy = (args: {
  voteShares: PartyShares;
  seatShares: PartyShares;
  partyIds: string[];
}) => {
  const votes = normalizeShares(args.voteShares, args.partyIds);
  const seats = normalizeShares(args.seatShares, args.partyIds);
  const represented = args.partyIds.reduce((sum, partyId) => {
    return sum + Math.min(votes[partyId], seats[partyId]);
  }, 0);
  return 1 - represented;
};
