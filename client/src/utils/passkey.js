// The browser's WebAuthn API deals in ArrayBuffers; the wire deals in
// base64url. That mismatch is the whole reason a helper library usually gets
// pulled in for this — but it is forty lines of encoding, and the alternative
// is a second dependency in the one part of the app where reading the code
// yourself has the most value.

const fromB64url = (value) => {
  const padded = String(value).replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

// Built up a character at a time rather than by spreading into fromCharCode:
// an attestation object is big enough to blow the argument limit on some
// browsers, and it fails as a stack overflow rather than as anything readable.
const toB64url = (buffer) => {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

// Older browsers, and anything not on HTTPS or localhost, have no WebAuthn at
// all. The UI asks first rather than offering a button that cannot work.
export const passkeysSupported = () =>
  typeof window !== 'undefined' && typeof window.PublicKeyCredential === 'function';

// A user cancelling the prompt, or letting it time out, both arrive as
// exceptions. Neither is an error worth showing a red banner for.
export const wasCancelled = (err) =>
  err?.name === 'NotAllowedError' || err?.name === 'AbortError';

export async function createPasskey(options) {
  const credential = await navigator.credentials.create({
    publicKey: {
      ...options,
      challenge: fromB64url(options.challenge),
      user: { ...options.user, id: fromB64url(options.user.id) },
      excludeCredentials: (options.excludeCredentials ?? []).map((c) => ({
        ...c,
        id: fromB64url(c.id),
      })),
    },
  });

  return {
    id: credential.id,
    rawId: toB64url(credential.rawId),
    type: credential.type,
    clientExtensionResults: credential.getClientExtensionResults(),
    response: {
      clientDataJSON: toB64url(credential.response.clientDataJSON),
      attestationObject: toB64url(credential.response.attestationObject),
      transports: credential.response.getTransports?.() ?? [],
    },
  };
}

// An empty list of credentials is left off the request rather than sent as an
// empty array, and the difference is the whole point of it: naming credentials
// tells the browser which ones are acceptable, and it then picks a route to one
// of them on your behalf. Sending none asks it to show you every passkey it
// actually holds for this site and let you choose. That is the way out when the
// browser keeps choosing a door the passkey is not behind.
export async function usePasskey(options) {
  const { allowCredentials, ...rest } = options;
  const publicKey = { ...rest, challenge: fromB64url(options.challenge) };
  if (allowCredentials?.length) {
    publicKey.allowCredentials = allowCredentials.map((c) => ({ ...c, id: fromB64url(c.id) }));
  }

  const credential = await navigator.credentials.get({ publicKey });

  return {
    id: credential.id,
    rawId: toB64url(credential.rawId),
    type: credential.type,
    clientExtensionResults: credential.getClientExtensionResults(),
    response: {
      clientDataJSON: toB64url(credential.response.clientDataJSON),
      authenticatorData: toB64url(credential.response.authenticatorData),
      signature: toB64url(credential.response.signature),
      userHandle: credential.response.userHandle
        ? toB64url(credential.response.userHandle)
        : undefined,
    },
  };
}
