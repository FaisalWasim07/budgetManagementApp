# Vendored from bklit-ui

The files in this directory are copied verbatim (except `charts/chart-formatters.ts`,
edited once, see its own comment) from https://github.com/bklit/bklit-ui, commit
c57f66b — `packages/ui/src/{charts,lib,components}`, MIT licensed
(`packages/ui`, not the proprietary Studio).

bklit ships no npm package: it is a shadcn-style registry, installed by copying
TSX into your own project (`npx shadcn add @bklit/bar-chart`). That CLI needs
bklit.com, which this build environment cannot reach, so these are a manual,
byte-exact copy of the same files it would have written — resolved from
`packages/ui/registry.json`'s own `registryDependencies` graph for exactly the
three chart types Bayt uses (`bar-chart`, `line-chart`, `pie-chart`), not the
whole library — `ring-chart` was tried first and swapped out once running it
showed why: `Ring` is bklit's Apple-Watch-style *concentric progress ring*
(each `<Ring index={i}>` is its own ring at its own radius, sized against a
`maxValue`), not a divided donut. `PieChart`/`PieSlice` is the one that
actually splits a single ring into proportional slices, which is what a
category breakdown needs. `index.js` beside this file is Bayt's own barrel — the upstream
`charts/index.ts` re-exports dozens of chart types (heatmap, sankey, radar,
gauge, funnel, scatter, sunburst, candlestick, choropleth, live-line, chart
brush/zoom, legacy legend...) that were never copied, so importing it directly
would throw on the first missing file.

`blocks/` is the same arrangement one level up: bklit's registry also ships
*blocks*, compositions of the charts, and `@bklit/stat-card-area-01` is the one
Bayt's KPI row is built on. Only one of its five files came over —
`stat-card-hover-bridge.tsx`, which is the only one carrying logic rather than
Tailwind. `blocks/index.js` says what happened to the other four; the short
version is that `registryDependencies` asked for shadcn's `card` and `badge`,
which Bayt has no business adopting when it already has `.card` and can draw a
badge in six lines of its own CSS. `components/charts/StatCard.jsx` is where
that adaptation lives.

Update by re-copying files from a fresh checkout of the upstream repo, the same
way they got here — never hand-edit generated-looking internals; if a real
customization is needed, do it the way `chart-formatters.ts` was: once, with a
comment saying why.
