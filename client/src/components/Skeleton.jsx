// What a list looks like before it knows anything.
//
// "Loading…" is a word where a list is about to be, so the screen changes shape
// twice: once when the word appears and again when it is replaced by rows of a
// different height. Placeholders in the shape of the thing arriving change it
// once, and the wait reads as the list drawing rather than as the screen being
// empty and then suddenly not.
//
// Only ever seen on a first visit. useLive hands back what it already has, so
// coming back to a screen shows the real rows immediately and refreshes behind
// them — there is nothing to stand in for.
export function SkeletonRows({ count = 5, amount = true }) {
  return (
    // aria-hidden and not announced: there is nothing here to read, and a
    // screen reader listing six empty rows is worse than silence. `aria-busy`
    // on the container is what actually says "wait".
    <div className="skeleton-rows" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div className="txn skeleton" key={i}>
          <span className="sk sk-tile" />
          <span className="sk-lines">
            {/* Uneven widths, because real descriptions are uneven — a column
                of identical bars reads as a loading graphic, not as text. */}
            <span className="sk sk-line" style={{ width: `${58 + ((i * 13) % 30)}%` }} />
            <span className="sk sk-line short" style={{ width: `${28 + ((i * 7) % 16)}%` }} />
          </span>
          {amount && <span className="sk sk-amount" />}
        </div>
      ))}
    </div>
  );
}
