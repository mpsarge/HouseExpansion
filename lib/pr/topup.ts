import { normalizeShares } from "./districtPlan";
import type { PartySeatResult, PartyShares } from "./types";

const initSeats = (partyIds: string[]) =>
  partyIds.reduce(
    (acc, partyId) => {
      acc[partyId] = 0;
      return acc;
    },
    {} as Record<string, number>
  );

export const allocateSainteLague = (
  voteShares: PartyShares,
  totalSeats: number,
  partyIds: string[]
) => {
  const normalized = normalizeShares(voteShares, partyIds);
  const seats = initSeats(partyIds);

  for (let i = 0; i < totalSeats; i += 1) {
    const winner = partyIds
      .map((partyId) => ({
        partyId,
        quotient: normalized[partyId] / (2 * seats[partyId] + 1),
      }))
      .sort((a, b) => b.quotient - a.quotient || a.partyId.localeCompare(b.partyId))[0];
    seats[winner.partyId] += 1;
  }

  return seats;
};

export const allocateTopUpSeats = (args: {
  partyIds: string[];
  totalSeats: number;
  topUpSeats: number;
  voteShares: PartyShares;
  districtSeatsByParty: PartySeatResult;
}) => {
  const ideal = allocateSainteLague(args.voteShares, args.totalSeats, args.partyIds);
  const topUp = initSeats(args.partyIds);

  for (let i = 0; i < args.topUpSeats; i += 1) {
    const winner = args.partyIds
      .map((partyId) => ({
        partyId,
        deficit:
          ideal[partyId] -
          (args.districtSeatsByParty[partyId] ?? 0) -
          (topUp[partyId] ?? 0),
      }))
      .sort((a, b) => b.deficit - a.deficit || a.partyId.localeCompare(b.partyId))[0];
    topUp[winner.partyId] += 1;
  }

  const finalSeats = initSeats(args.partyIds);
  args.partyIds.forEach((partyId) => {
    finalSeats[partyId] =
      (args.districtSeatsByParty[partyId] ?? 0) + (topUp[partyId] ?? 0);
  });

  return { idealSeats: ideal, topUpSeatsByParty: topUp, finalSeatsByParty: finalSeats };
};
