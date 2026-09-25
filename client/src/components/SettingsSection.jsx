import { ChevronDown } from './icons';

// One job in the settings dialog: what it is, where it stands, and the
// controls for it once you ask.
//
// The Account tab used to be three of these stacked open, separated by
// hairlines, every one carrying several lines of explanation. It came to
// nearly a thousand pixels — most of a laptop screen, inside a dialog — and
// none of it was scannable, because the three headings were the same weight
// as each other and as everything under them. Whatever you had opened Settings
// to do, you read the whole thing to find it.
//
// Closed, each is a line that answers the question people actually arrive
// with: am I signed in, do I have a passkey, are notifications on. Open, it is
// exactly what it was. The prose did not need deleting — it needed to stop
// being the first thing on screen.
//
// `<details>` rather than a div and a piece of state: it is disclosure, which
// is a thing browsers already do, with the keyboard behaviour, the focus
// handling and the screen-reader announcement already correct. A div with an
// onClick would be a worse version of this that we would then have to
// maintain.
export default function SettingsSection({ title, state, loading = false, defaultOpen = false, children }) {
  return (
    <details className="set-section" open={defaultOpen}>
      <summary>
        <span className="set-section-title">{title}</span>
        {/* Where it stands, said on the closed row so the tab can be read
            without opening anything. While it is still being fetched this says
            so rather than showing a default that happens to look like an
            answer — "Off" before anything has been asked is a lie about your
            settings, and the one a person would act on. */}
        <span className={`set-section-state${loading ? ' is-loading' : ''}`}>
          {loading ? <span className="set-section-dots" aria-label="Loading" /> : state}
        </span>
        <ChevronDown size={13} />
      </summary>
      <div className="set-section-body">{children}</div>
    </details>
  );
}
