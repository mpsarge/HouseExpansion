export type PartyAllocation = {
  partyA: number;
  partyB: number;
};

export type ThreePartyAllocation = {
  democrats: number;
  republicans: number;
  independents: number;
};

export const hamiltonAllocation = (
  totalSeats: number,
  partyAShare: number
): PartyAllocation => {
  const rawA = totalSeats * partyAShare;
  const rawB = totalSeats * (1 - partyAShare);
  const baseA = Math.floor(rawA);
  const baseB = Math.floor(rawB);
  let allocated = baseA + baseB;
  let partyASeats = baseA;
  let partyBSeats = baseB;

  const remainders = [
    { party: "A", value: rawA - baseA },
    { party: "B", value: rawB - baseB },
  ].sort((a, b) => b.value - a.value);

  let idx = 0;
  while (allocated < totalSeats) {
    const pick = remainders[idx % remainders.length];
    if (pick.party === "A") {
      partyASeats += 1;
    } else {
      partyBSeats += 1;
    }
    allocated += 1;
    idx += 1;
  }

  return { partyA: partyASeats, partyB: partyBSeats };
};

export const hamiltonThreePartyAllocation = (
  totalSeats: number,
  democratsShare: number,
  independentsShare: number
): ThreePartyAllocation => {
  const safeDemocrats = Math.min(1, Math.max(0, democratsShare));
  const safeIndependents = Math.min(1, Math.max(0, independentsShare));
  const combined = safeDemocrats + safeIndependents;
  const normalizedDemocrats =
    combined > 1 ? safeDemocrats / combined : safeDemocrats;
  const normalizedIndependents =
    combined > 1 ? safeIndependents / combined : safeIndependents;
  const normalizedRepublicans = Math.max(
    0,
    1 - normalizedDemocrats - normalizedIndependents
  );

  const allocations = [
    { party: "democrats", raw: totalSeats * normalizedDemocrats },
    { party: "republicans", raw: totalSeats * normalizedRepublicans },
    { party: "independents", raw: totalSeats * normalizedIndependents },
  ] as const;

  const base = allocations.map((entry) => ({
    party: entry.party,
    seats: Math.floor(entry.raw),
    remainder: entry.raw - Math.floor(entry.raw),
  }));

  let allocated = base.reduce((acc, entry) => acc + entry.seats, 0);
  const seats = {
    democrats: base.find((entry) => entry.party === "democrats")?.seats ?? 0,
    republicans: base.find((entry) => entry.party === "republicans")?.seats ?? 0,
    independents:
      base.find((entry) => entry.party === "independents")?.seats ?? 0,
  };

  const remainders = [...base].sort((a, b) => b.remainder - a.remainder);
  let idx = 0;
  while (allocated < totalSeats) {
    const pick = remainders[idx % remainders.length];
    seats[pick.party] += 1;
    allocated += 1;
    idx += 1;
  }

  return seats;
};

export const seatShareFromVote = (
  voteShare: number,
  responsiveness: "low" | "medium" | "high"
) => {
  const factor = responsiveness === "low" ? 0.6 : responsiveness === "high" ? 1.4 : 1;
  const adjusted = 0.5 + (voteShare - 0.5) * factor;
  return Math.min(1, Math.max(0, adjusted));
};
