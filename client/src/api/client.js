// Fired when the server says the session is gone — the auth gate listens for
// this and shows the login screen, so an expired session doesn't leave every
// panel on the page showing its own "Not signed in" error.
export const UNAUTHORIZED_EVENT = 'budget:unauthorized';

// Which household every request is about. Held here rather than threaded
// through every call site, because it applies to all of them equally — the
// server still verifies membership, so this is a preference, not a permission.
let activeHousehold = null;
export const setActiveHousehold = (id) => {
  activeHousehold = id ?? null;
};

// A request that never got a reply at all — the connection died, the host gave
// up, the phone changed network. Distinct from an error the server sent, which
// arrives as an ordinary Error with the server's own words in it, because the
// two want different things done about them: this one is worth retrying.
export class NetworkError extends Error {
  constructor(cause) {
    super('The connection dropped before an answer came back.');
    this.name = 'NetworkError';
    this.cause = cause;
  }
}

async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(`/api${path}`, {
      // Balances change under these URLs constantly, and a reply from a cache is
      // the app quietly showing you last minute's money.
      cache: 'no-store',
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(activeHousehold ? { 'X-Household-Id': String(activeHousehold) } : {}),
        ...options.headers,
      },
    });
  } catch (err) {
    // fetch rejects only when the request did not complete. Every browser words
    // this uselessly — Safari says "Load failed", Chrome "Failed to fetch" —
    // and those words went straight to the screen, where they told nobody
    // anything. What actually happened is that nothing came back.
    throw new NetworkError(err);
  }
  if (!response.ok) {
    // The auth routes are how you get in, so a 401 there is a wrong password
    // being reported normally, not a session that has just lapsed.
    if (response.status === 401 && !path.startsWith('/auth/')) {
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    }
    let message = `Request failed: ${response.status}`;
    try {
      const body = await response.json();
      if (body.error) message = body.error;
      // Server errors carry a short code (ENOTFOUND, 28P01, …). Showing it
      // saves digging through host logs to find out what actually broke.
      if (body.code) message += ` (${body.code})`;
    } catch {
      // ignore parse failure, keep default message
    }
    throw new Error(message);
  }
  if (response.status === 204) return null;
  return response.json();
}

export function get(path) {
  return request(path);
}

export function post(path, body) {
  return request(path, { method: 'POST', body: JSON.stringify(body) });
}

export function put(path, body) {
  return request(path, { method: 'PUT', body: JSON.stringify(body) });
}

export function patch(path, body) {
  return request(path, { method: 'PATCH', body: JSON.stringify(body) });
}

// Takes a body, because removing a passkey has to be confirmed with a
// password and there is nowhere sensible to put one but the body.
export function del(path, body) {
  return request(path, {
    method: 'DELETE',
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
