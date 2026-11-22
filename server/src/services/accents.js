// The colours a person can pick for their own view of the app.
//
// Checked here rather than taken on trust because the name ends up as an
// attribute on the page (`data-accent`) — not dangerous in itself, but a
// column that accepts anything is a column that eventually holds anything, and
// then every client has to guess what an unknown value means.
//
// The same list, in the same order, lives in client/src/utils/accent.js (the
// swatches) and in index.css (the colours). Adding one means all three; the
// accent test checks the server and client lists agree.
//
// `null` in the column means "never chose", which renders as mint — the brand.
// Choosing mint stores 'mint', so the two stay distinguishable if the default
// ever changes.
const ACCENTS = ['mint', 'ocean', 'indigo', 'plum', 'clay', 'moss', 'graphite'];

const isAccent = (value) => typeof value === 'string' && ACCENTS.includes(value);

module.exports = { ACCENTS, isAccent };
