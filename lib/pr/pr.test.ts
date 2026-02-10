import { describe, expect, it } from "vitest";
import { buildDistrictPlan } from "./districtPlan";
import { generateRankedBallots } from "./ballotGenerator";
import { runSTV } from "./stv";
import { runHybridPRByState } from "./simulate";
import { allocateSainteLague } from "./topup";
import { DEFAULT_PARTIES, DEFAULT_PR_SETTINGS, type StateVotes } from "./types";

const partyIds = DEFAULT_PARTIES.map((party) => party.id);

const seatDistance = (a: Record<string, number>, b: Record<string, number>) =>
  partyIds.reduce((sum, partyId) => sum + Math.abs((a[partyId] ?? 0) - (b[partyId] ?? 0)), 0);

describe("district planning", () => {
  it("builds near-target districts in bounds", () => {
    const plan = buildDistrictPlan("XX", 11, {
      ...DEFAULT_PR_SETTINGS,
      districtSeatTarget: 5,
      minDistrictSeats: 3,
      maxDistrictSeats: 7,
    });
    const seats = plan.districts.map((district) => district.seats);
    expect(seats.reduce((sum, value) => sum + value, 0)).toBe(11);
    expect(seats.every((value) => value >= 3 && value <= 7)).toBe(true);
  });
});

describe("stv", () => {
  it("is approximately proportional in symmetric vote scenario", () => {
    const shares = { dem: 0.5, rep: 0.5, ind: 0 };
    const seats = 6;
    const ballotsRunA = generateRankedBallots({
      partyIds,
      partyShares: shares,
      seats,
      ballotCount: 3000,
      seed: 42,
    });
    const ballotsRunB = generateRankedBallots({
      partyIds,
      partyShares: shares,
      seats,
      ballotCount: 12000,
      seed: 42,
    });

    const resA = runSTV({ seats, ...ballotsRunA });
    const resB = runSTV({ seats, ...ballotsRunB });
    const demGapA = Math.abs((resA.seatsByParty.dem ?? 0) - 3);
    const demGapB = Math.abs((resB.seatsByParty.dem ?? 0) - 3);
    expect(demGapB).toBeLessThanOrEqual(demGapA);
  });

  it("handles 1-seat and 2-seat contests deterministically", () => {
    const oneSeatBallots = generateRankedBallots({
      partyIds,
      partyShares: { dem: 0.7, rep: 0.3, ind: 0 },
      seats: 1,
      ballotCount: 1000,
      seed: 5,
    });
    const oneSeatResult = runSTV({ seats: 1, ...oneSeatBallots });
    expect(oneSeatResult.electedCandidateIds).toHaveLength(1);

    const twoSeatBallots = generateRankedBallots({
      partyIds,
      partyShares: { dem: 0.5, rep: 0.5, ind: 0 },
      seats: 2,
      ballotCount: 2000,
      seed: 10,
    });
    const resultA = runSTV({ seats: 2, ...twoSeatBallots });
    const resultB = runSTV({ seats: 2, ...twoSeatBallots });
    expect(resultA.electedCandidateIds).toEqual(resultB.electedCandidateIds);
  });

  it("handles zero-share parties", () => {
    const ballots = generateRankedBallots({
      partyIds,
      partyShares: { dem: 1, rep: 0, ind: 0 },
      seats: 3,
      ballotCount: 2000,
      seed: 12,
    });
    const result = runSTV({ seats: 3, ...ballots });
    expect(result.seatsByParty.dem).toBe(3);
    expect(result.seatsByParty.rep ?? 0).toBe(0);
  });
});

describe("top-up", () => {
  it("moves totals closer to statewide ideal than district-only", () => {
    const states: StateVotes[] = [
      { stateCode: "AA", partyShares: { dem: 0.54, rep: 0.44, ind: 0.02 } },
      { stateCode: "BB", partyShares: { dem: 0.47, rep: 0.50, ind: 0.03 } },
    ];
    const seats = { AA: 10, BB: 9 };

    const withoutTopUp = runHybridPRByState({
      parties: DEFAULT_PARTIES,
      states,
      stateSeats: seats,
      settings: { ...DEFAULT_PR_SETTINGS, useTopUp: false, randomSeed: 100 },
    });
    const withTopUp = runHybridPRByState({
      parties: DEFAULT_PARTIES,
      states,
      stateSeats: seats,
      settings: {
        ...DEFAULT_PR_SETTINGS,
        useTopUp: true,
        topUpSeatShare: 0.2,
        randomSeed: 100,
      },
    });

    const idealAA = allocateSainteLague(states[0].partyShares, 10, partyIds);
    const idealBB = allocateSainteLague(states[1].partyShares, 9, partyIds);

    const distWithout =
      seatDistance(withoutTopUp[0].finalSeatsByParty, idealAA) +
      seatDistance(withoutTopUp[1].finalSeatsByParty, idealBB);
    const distWith =
      seatDistance(withTopUp[0].finalSeatsByParty, idealAA) +
      seatDistance(withTopUp[1].finalSeatsByParty, idealBB);

    expect(distWith).toBeLessThanOrEqual(distWithout);
  });
});
