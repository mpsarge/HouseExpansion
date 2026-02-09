import type { StatePopulation } from "@/lib/metrics";

export type HouseModelKey =
  | "manual"
  | "cubeRoot"
  | "proportional500k"
  | "wyomingRule";

const clampHouseSize = (value: number) => Math.min(1200, Math.max(435, value));

export const houseModelLabel = (model: HouseModelKey) => {
  if (model === "cubeRoot") return "Cube-root model";
  if (model === "proportional500k") return "Proportional (500k/seat)";
  if (model === "wyomingRule") return "Wyoming rule";
  return "Manual";
};

export const computeHouseSizeByModel = (
  model: HouseModelKey,
  states: StatePopulation[],
  manualSeats: number
) => {
  if (model === "manual") {
    return clampHouseSize(manualSeats);
  }

  const nonDc = states.filter((state) => state.abbr !== "DC");
  const nationalPopulation = nonDc.reduce((sum, state) => sum + state.population, 0);

  if (model === "cubeRoot") {
    return clampHouseSize(Math.round(Math.cbrt(nationalPopulation)));
  }

  if (model === "proportional500k") {
    return clampHouseSize(Math.round(nationalPopulation / 500_000));
  }

  const smallestStatePopulation = nonDc.reduce(
    (min, state) => Math.min(min, state.population),
    Number.POSITIVE_INFINITY
  );
  return clampHouseSize(Math.round(nationalPopulation / smallestStatePopulation));
};

