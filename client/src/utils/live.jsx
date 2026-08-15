import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

// Data that survives leaving the page it is on.
//
// Every screen used to hold its own list in its own state, and a screen that is
// not the current one is not rendered — so navigating away threw the data out
// and coming back re-fetched it from nothing. That is why Activity and
// Recurring flashed empty every single time you opened them, while Home and
// Stats did not: their figures live in App, which never unmounts.
//
// So the answer is not to keep the pages mounted, it is to keep the *data*
// outside them. What is already known is shown immediately and refreshed
// behind, which is the difference between a screen that loads and a screen that
// is simply there.
//
// Deliberately not a caching library. Two rules cover everything here:
//   - a key is a resource and the month it is for, so changing month is a
//     different key rather than an invalidation;
//   - a write refreshes; nothing expires on a timer. Money does not change
//     because time passed, it changes because somebody recorded something.
const cache = new Map();

// Everything held is one household's, so switching household drops all of it
// rather than briefly showing one household's entries under another's name.
export function clearLiveCache() {
  cache.clear();
}

const LiveContext = createContext(null);

export function LiveDataProvider({ children }) {
  // How many requests are in the air, from anywhere. The top bar shows one
  // spinner for all of them.
  const [inFlight, setInFlight] = useState(0);
  // Every mounted source's own reload, so the refresh button can re-run
  // whatever the screen you are actually on happens to need — without the bar
  // having to know which screen that is.
  const sources = useRef(new Set());

  const register = useCallback((reload) => {
    sources.current.add(reload);
    return () => sources.current.delete(reload);
  }, []);

  const track = useCallback(async (run) => {
    setInFlight((n) => n + 1);
    try {
      return await run();
    } finally {
      setInFlight((n) => Math.max(0, n - 1));
    }
  }, []);

  const refreshAll = useCallback(
    () => Promise.all([...sources.current].map((reload) => reload())),
    []
  );

  return (
    <LiveContext.Provider value={{ register, track, refreshAll, busy: inFlight > 0 }}>
      {children}
    </LiveContext.Provider>
  );
}

export function useLiveData() {
  const ctx = useContext(LiveContext);
  if (!ctx) throw new Error('useLiveData outside LiveDataProvider');
  return ctx;
}

// `key` identifies the data; `fetcher` goes and gets it. Returns whatever is
// already known — possibly from a previous visit — plus a reload the page can
// call after it writes something.
export function useLive(key, fetcher) {
  const { register, track } = useLiveData();
  const [data, setData] = useState(() => cache.get(key));
  const [error, setError] = useState(null);
  // Held in a ref so a fetcher written inline — which every call site does —
  // does not re-run the request on every render.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const reload = useCallback(
    () =>
      track(async () => {
        try {
          const next = await fetcherRef.current();
          cache.set(key, next);
          if (alive.current) {
            setData(next);
            setError(null);
          }
        } catch (err) {
          // The stale figures stay on screen. A failed refresh is worth saying
          // so about, but it is not worth blanking a screen that was correct a
          // moment ago.
          if (alive.current) setError(err.message);
        }
      }),
    [key, track]
  );

  // A new key shows that key's own cached value straight away rather than the
  // previous month's figures under the new month's heading.
  useEffect(() => {
    setData(cache.get(key));
  }, [key]);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => register(reload), [register, reload]);

  return { data, error, reload };
}
