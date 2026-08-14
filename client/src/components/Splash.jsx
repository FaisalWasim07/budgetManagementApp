import { Mark } from './icons';

// What the app is while it is finding out whether you are signed in and which
// households you are in. Two waits happen back to back on a cold open, so both
// use this: one screen that stays put rather than two that swap.
//
// The name and mark carry the wait. A spinner alone says "something is
// happening"; a spinner under the logo says which app is starting, which is
// the only thing worth saying before there is anything to show.
export default function Splash() {
  return (
    <div className="splash">
      <span className="brand">
        <Mark size={40} />
        <span className="wordmark">Bayt</span>
      </span>
      <span className="spinner" role="status" aria-label="Loading" />
    </div>
  );
}
