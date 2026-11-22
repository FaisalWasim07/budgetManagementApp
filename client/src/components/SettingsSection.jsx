import { ChevronDown } from './icons';

// One job in the settings dialog, as a card: an icon tile, what it is and a
// line saying what it is for, then its controls underneath.
//
// Open by default now. The cards used to arrive closed, each a single line
// with its state on the right, because three of them stacked open with long
// paragraphs came to most of a laptop screen. The paragraphs are what made
// them long; with those cut to a hint each, open fits, and opening Settings to
// change one thing no longer starts with finding which row to open. They still
// fold, and folded they still say where they stand.
//
// `<details>` rather than a div and a piece of state: disclosure is a thing
// browsers already do, with the keyboard behaviour, focus handling and
// screen-reader announcement already right.
//
// `action` is a control that belongs on the card's top line whether it is open
// or not: the notifications switch, the colour picker. It sits beside the
// summary rather than inside it, because a button inside a <summary> is a
// button inside another button, and pressing it would also fold the card.
// A card with no children is just that top line, and does not fold.
export default function SettingsSection({
  icon,
  title,
  subtitle,
  state,
  loading = false,
  defaultOpen = true,
  action,
  children,
}) {
  const head = (
    <>
      {icon && (
        <span className="icon-tile" aria-hidden="true">
          {icon}
        </span>
      )}
      <span className="set-head">
        <span className="set-section-title">{title}</span>
        {subtitle && <span className="set-sub">{subtitle}</span>}
      </span>
      {/* Where it stands, for the folded card. While it is still being fetched
          this says so rather than showing a default that happens to look like
          an answer: "Off" before anything has been asked is a lie about your
          settings, and the one a person would act on. */}
      {state != null && (
        <span className={`set-section-state${loading ? ' is-loading' : ''}`}>
          {loading ? <span className="set-section-dots" aria-label="Loading" /> : state}
        </span>
      )}
    </>
  );

  if (!children) {
    return (
      <div className={`set-card${action ? ' has-action' : ''}`}>
        <div className="set-section static">
          <div className="set-top">{head}</div>
        </div>
        {action && <div className="set-action">{action}</div>}
      </div>
    );
  }

  return (
    <div className={`set-card${action ? ' has-action' : ''}`}>
      <details className="set-section" open={defaultOpen}>
        <summary className="set-top">
          {head}
          <ChevronDown size={14} />
        </summary>
        <div className="set-section-body">{children}</div>
      </details>
      {action && <div className="set-action">{action}</div>}
    </div>
  );
}
