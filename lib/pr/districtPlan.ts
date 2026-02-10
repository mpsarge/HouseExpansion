import type { DistrictPlan, DistrictSpec, PRSettings } from "./types";

export const clampPRSettings = (settings: PRSettings): PRSettings => {
  const minDistrictSeats = Math.max(1, Math.min(10, settings.minDistrictSeats));
  const maxDistrictSeats = Math.max(minDistrictSeats, Math.min(12, settings.maxDistrictSeats));
  const districtSeatTarget = Math.max(
    minDistrictSeats,
    Math.min(maxDistrictSeats, settings.districtSeatTarget)
  );

  return {
    ...settings,
    minDistrictSeats,
    maxDistrictSeats,
    districtSeatTarget,
    topUpSeatShare: Math.max(0, Math.min(0.3, settings.topUpSeatShare)),
    stvBallotsPerSeat: Math.max(100, Math.round(settings.stvBallotsPerSeat)),
  };
};

const scorePlan = (parts: number[], target: number) => {
  const mean = parts.reduce((sum, value) => sum + value, 0) / parts.length;
  const variance =
    parts.reduce((sum, value) => sum + (value - mean) ** 2, 0) / parts.length;
  const targetPenalty = parts.reduce((sum, value) => sum + Math.abs(value - target), 0);
  return variance * 10 + targetPenalty;
};

const buildBalancedParts = (
  total: number,
  count: number,
  min: number,
  max: number
): number[] | null => {
  if (count <= 0) return null;
  if (count * min > total || count * max < total) return null;

  const base = Math.floor(total / count);
  let remainder = total - base * count;
  const parts = Array.from({ length: count }, () => base);

  for (let i = 0; i < parts.length && remainder > 0; i += 1) {
    if (parts[i] < max) {
      parts[i] += 1;
      remainder -= 1;
    }
  }

  for (let i = parts.length - 1; i >= 0; i -= 1) {
    while (parts[i] > max && remainder >= 0) {
      parts[i] -= 1;
      remainder += 1;
    }
  }

  for (let i = 0; i < parts.length; i += 1) {
    while (parts[i] < min && remainder > 0) {
      parts[i] += 1;
      remainder -= 1;
    }
  }

  if (remainder !== 0) {
    return null;
  }

  if (parts.some((value) => value < min || value > max)) {
    return null;
  }

  return parts.sort((a, b) => b - a);
};

const chooseDistrictSeatCounts = (
  totalSeats: number,
  target: number,
  min: number,
  max: number
) => {
  if (totalSeats <= max && totalSeats < min) {
    return [totalSeats];
  }
  if (totalSeats < min) {
    return [totalSeats];
  }

  let best: number[] | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  const minCount = Math.ceil(totalSeats / max);
  const maxCount = Math.max(minCount, Math.floor(totalSeats / min));

  for (let count = minCount; count <= maxCount; count += 1) {
    const parts = buildBalancedParts(totalSeats, count, min, max);
    if (!parts) continue;
    const score = scorePlan(parts, target);
    if (score < bestScore) {
      bestScore = score;
      best = parts;
    }
  }

  return best ?? [totalSeats];
};

export const buildDistrictPlan = (
  stateCode: string,
  totalSeats: number,
  settings: PRSettings
): DistrictPlan => {
  const safe = clampPRSettings(settings);
  const districtSeats = chooseDistrictSeatCounts(
    totalSeats,
    safe.districtSeatTarget,
    safe.minDistrictSeats,
    safe.maxDistrictSeats
  );

  const districts: DistrictSpec[] = districtSeats.map((seats, index) => ({
    districtId: `${stateCode}-${index + 1}`,
    seats,
  }));

  return { stateCode, districts };
};

export const normalizeShares = (
  input: Record<string, number>,
  partyIds: string[]
): Record<string, number> => {
  const next: Record<string, number> = {};
  partyIds.forEach((partyId) => {
    next[partyId] = Math.max(0, input[partyId] ?? 0);
  });
  const total = partyIds.reduce((sum, partyId) => sum + next[partyId], 0);
  if (total <= 0) {
    const even = 1 / Math.max(1, partyIds.length);
    partyIds.forEach((partyId) => {
      next[partyId] = even;
    });
    return next;
  }
  partyIds.forEach((partyId) => {
    next[partyId] /= total;
  });
  return next;
};
