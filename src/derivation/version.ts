// Derivation version. Bump whenever any detector, merger, or metric changes
// in a way that would produce different output for the same fills.
// Every derived row carries this as `derivation_version`.
//
// v2: Added dayOfWeekMetric table (7×24 heatmap by day-of-week + hour-of-day).
//     Users must run `pnpm rederive` after deploy to populate the new metric.
//
// v3: Added plan_adherence detector + position.planId field threading through
//     derivation context. Users must run `pnpm rederive` after deploy so that
//     plan links are re-attached and findings are generated at the new version.
export const DERIVATION_VERSION = 3
