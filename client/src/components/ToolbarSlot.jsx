import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

// The mockup's toolbar is one row: the page's name, then the month, then
// whatever that page's own action is. The app had grown a second row under the
// bar on every screen — a lone "+ Add recurring", a search box under a "This
// month" heading — which is what made the screens read as a different design.
//
// A portal rather than props threaded through App: the page still owns the
// button and the state behind it, it just paints it in the bar.
export default function ToolbarSlot({ children }) {
  const [slot, setSlot] = useState(null);
  useEffect(() => setSlot(document.getElementById('tool-slot')), []);
  return slot ? createPortal(children, slot) : null;
}
