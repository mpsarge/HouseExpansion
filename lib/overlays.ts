export type PartyAllocation = {
  partyA: number;
  partyB: number;
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

export const seatShareFromVote = (
  voteShare: number,
  responsiveness: "low" | "medium" | "high"
) => {
  const factor = responsiveness === "low" ? 0.6 : responsiveness === "high" ? 1.4 : 1;
  const adjusted = 0.5 + (voteShare - 0.5) * factor;
  return Math.min(1, Math.max(0, adjusted));
};
