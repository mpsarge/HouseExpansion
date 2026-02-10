export type Party = {
  id: string;
  name: string;
  color?: string;
};

export type PartyShares = Record<string, number>;

export type StateVotes = {
  stateCode: string;
  partyShares: PartyShares;
};

export type DistrictSpec = {
  districtId: string;
  seats: number;
  partyShares?: PartyShares;
};

export type DistrictPlan = {
  stateCode: string;
  districts: DistrictSpec[];
};

export type PRSettings = {
  districtSeatTarget: number;
  minDistrictSeats: number;
  maxDistrictSeats: number;
  useTopUp: boolean;
  topUpSeatShare: number;
  stvBallotsPerSeat: number;
  randomSeed: number;
};

export type PartySeatResult = Record<string, number>;

export type StatePRResult = {
  stateCode: string;
  totalSeats: number;
  districtSeats: number;
  topUpSeats: number;
  voteShares: PartyShares;
  districtSeatsByParty: PartySeatResult;
  finalSeatsByParty: PartySeatResult;
  gallagher: number;
  wastedVotesProxy: number;
  districtPlan: DistrictPlan;
};

export type NationalPRResult = {
  totalSeatsByParty: PartySeatResult;
  totalVotesByParty: PartyShares;
  gallagher: number;
  wastedVotesProxy: number;
};

export const DEFAULT_PR_SETTINGS: PRSettings = {
  districtSeatTarget: 5,
  minDistrictSeats: 3,
  maxDistrictSeats: 7,
  useTopUp: true,
  topUpSeatShare: 0.1,
  stvBallotsPerSeat: 2000,
  randomSeed: 2026,
};

export const DEFAULT_PARTIES: Party[] = [
  { id: "dem", name: "Democrats", color: "#3b82f6" },
  { id: "rep", name: "Republicans", color: "#ef4444" },
  { id: "ind", name: "Independents", color: "#64748b" },
];

