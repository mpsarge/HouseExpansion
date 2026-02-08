import { describe, expect, it } from "vitest";
import populations from "../data/populations.json";
import { apportion } from "./apportionment";
import type { StatePopulation } from "./metrics";

describe("apportionment", () => {
  const stateData = populations as StatePopulation[];
  const populationsByState: Record<string, number> = {};
  stateData
    .filter((state) => state.abbr !== "DC")
    .forEach((state) => {
      populationsByState[state.abbr] = state.population;
    });

  it("allocates the correct total number of seats", () => {
    const seats = apportion(populationsByState, 500);
    const total = Object.values(seats).reduce((acc, value) => acc + value, 0);
    expect(total).toBe(500);
  });

  it("gives every state at least one seat", () => {
    const seats = apportion(populationsByState, 435);
    Object.values(seats).forEach((value) => {
      expect(value).toBeGreaterThanOrEqual(1);
    });
  });

  it("matches known 2020 apportionment totals for key states", () => {
    const seats = apportion(populationsByState, 435);
    expect(seats.CA).toBe(52);
    expect(seats.TX).toBe(38);
    expect(seats.FL).toBe(28);
    expect(seats.NY).toBe(26);
  });
});
