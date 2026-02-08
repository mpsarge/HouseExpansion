# House Expansion Lab

House Expansion Lab is a Next.js (App Router) + TypeScript project that lets you explore how changing the size of the U.S. House changes state apportionment and Electoral College votes. The UI updates in real time with a slider and shows state-by-state metrics in a choropleth tile map and sortable table.

## How apportionment works

This app uses the **Method of Equal Proportions (Huntington–Hill)**:

1. Every state starts with **1 seat**.
2. Remaining seats are distributed by highest priority value:

```
priority = P / sqrt(n(n + 1))
```

Where `P` is the state population and `n` is its current seat count.

The implementation lives in [`/lib/apportionment.ts`](./lib/apportionment.ts). It uses a max-heap for deterministic allocation and is covered by unit tests.

## Electoral College calculation

Electoral College votes are computed as:

```
EC votes = House seats + 2
```

The District of Columbia is always **3 EC votes** and **is not** included in the House apportionment calculation. These helpers live in [`/lib/metrics.ts`](./lib/metrics.ts).

## Simulation overlays (teaching tools)

The overlay modes are **explicitly simulations, not predictions**. They do not depend on district geometry or gerrymandering.

1. **Proportional-by-statewide-vote (Hamilton method)**
   - Each state gets a Party A vote share (slider).
   - House seats are allocated proportionally using Hamilton’s method.
   - Implemented in [`/lib/overlays.ts`](./lib/overlays.ts).
2. **Seat–vote curve (stub)**
   - Applies a responsiveness factor to statewide vote share (low/medium/high).
   - The placeholder function is simple and documented in the same module.

## Replacing population data

Population data lives in [`/data/populations.json`](./data/populations.json) with the format:

```json
[{ "state": "Alabama", "abbr": "AL", "fips": "01", "population": 5024279 }]
```

To swap datasets:

1. Replace the JSON file (keep the same schema).
2. Ensure all 50 states are included.
3. Include DC for display, but it will not be used in apportionment.

## Adding new metrics

Derived metrics are computed in [`/lib/metrics.ts`](./lib/metrics.ts). To add a new metric:

1. Update the `StateMetrics` type.
2. Add it to `buildStateMetrics`.
3. Add a new metric option in [`/components/Controls.tsx`](./components/Controls.tsx).
4. Update the map + table to read the new key.

## Development

```bash
npm install
npm run dev
```

## Tests

```bash
npm run test
```
