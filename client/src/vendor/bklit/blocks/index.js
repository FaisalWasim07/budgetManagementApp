// Bayt's barrel for the vendored bklit *blocks* — the same idea as
// ../charts/index.js, and for the same reason: the upstream block ships more
// files than Bayt took. Of `@bklit/stat-card-area-01`'s five, only the hover
// bridge is real logic; `stat-card-area.tsx` is a demo wired to sample revenue,
// `trend-badge.tsx` wants shadcn's Badge and an icon package Bayt does not
// have, `stat-card-chart.tsx` is Tailwind layout Bayt already expresses in
// `.kpi` CSS, and `data/revenue-series.ts` is the sample data. Those four are
// re-expressed in Bayt's own CSS by components/charts/StatCard.jsx.
export {
  StatCardHoverBridge,
  formatStatCardMonth,
} from './stat-card-area-01/stat-card-hover-bridge.tsx';
