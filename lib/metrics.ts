export type StatePopulation = {
  state: string;
  abbr: string;
  fips: string;
  population: number;
};

export type StateMetrics = {
  state: string;
  abbr: string;
  population: number;
  houseSeats: number;
  houseDelta: number;
  ecVotes: number;
  ecDelta: number;
  ecPerMillion: number;
};

export const computeECVotes = (abbr: string, houseSeats: number) =>
  abbr === "DC" ? 3 : houseSeats + 2;

export const buildStateMetrics = (
  data: StatePopulation,
  seatsByState: Record<string, number>,
  baselineSeats: Record<string, number>
): StateMetrics => {
  const houseSeats = seatsByState[data.abbr] ?? 0;
  const baselineHouse = baselineSeats[data.abbr] ?? 0;
  const ecVotes = computeECVotes(data.abbr, houseSeats);
  const baselineEc = computeECVotes(data.abbr, baselineHouse);
  const ecPerMillion = ecVotes / (data.population / 1_000_000);

  return {
    state: data.state,
    abbr: data.abbr,
    population: data.population,
    houseSeats,
    houseDelta: houseSeats - baselineHouse,
    ecVotes,
    ecDelta: ecVotes - baselineEc,
    ecPerMillion,
  };
};

export const formatNumber = (value: number, digits = 0) =>
  new Intl.NumberFormat("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value);
