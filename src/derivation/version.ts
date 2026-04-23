// Derivation version. Bump whenever any detector, merger, or metric changes
// in a way that would produce different output for the same fills.
// Every derived row carries this as `derivation_version`.
//
// v2: Added dayOfWeekMetric table (7×24 heatmap by day-of-week + hour-of-day).
//     Users must run `pnpm rederive` after deploy to populate the new metric.
export const DERIVATION_VERSION = 2
