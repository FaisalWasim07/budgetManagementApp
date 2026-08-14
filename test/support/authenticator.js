// A passkey, in software.
//
// The alternative was to stub the verification out, which would have tested
// that a stub returns true. This makes a real P-256 keypair, builds the same
// bytes a phone builds, and signs them — so the suite exercises the actual
// verification path, cloning check included.
//
// Only the slice of CBOR the WebAuthn structures need is implemented here:
// small integers, byte strings, text strings and maps. Encoding only, and only
// for the shapes below.

const crypto = require('crypto');

function head(major, length) {
  if (length < 24) return Buffer.from([(major << 5) | length]);
  if (length < 0x100) return Buffer.from([(major << 5) | 24, length]);
  if (length < 0x10000) {
    const buf = Buffer.alloc(3);
    buf[0] = (major << 5) | 25;
    buf.writeUInt16BE(length, 1);
    return buf;
  }
  const buf = Buffer.alloc(5);
  buf[0] = (major << 5) | 26;
  buf.writeUInt32BE(length, 1);
  return buf;
}

function cbor(value) {
  if (typeof value === 'number') {
    // Negative integers are stored as -1 minus the value, which is how COSE
    // spells the algorithm identifiers (-7 for ES256) and the key fields.
    return value >= 0 ? head(0, value) : head(1, -value - 1);
  }
  if (typeof value === 'string') {
    const bytes = Buffer.from(value, 'utf8');
    return Buffer.concat([head(3, bytes.length), bytes]);
  }
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    const bytes = Buffer.from(value);
    return Buffer.concat([head(2, bytes.length), bytes]);
  }
  if (value instanceof Map) {
    const parts = [head(5, value.size)];
    for (const [key, item] of value) parts.push(cbor(key), cbor(item));
    return Buffer.concat(parts);
  }
  throw new Error(`cannot encode ${typeof value}`);
}

// User present (0x01), user verified (0x04), attested credential data (0x40).
// Registration carries the credential; signing in does not.
const FLAGS_REGISTER = 0x45;
const FLAGS_ASSERT = 0x05;

function authenticator(rpId = 'localhost') {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
  });
  const jwk = publicKey.export({ format: 'jwk' });
  const credentialId = crypto.randomBytes(32);
  const id = credentialId.toString('base64url');
  const rpIdHash = crypto.createHash('sha256').update(rpId).digest();

  // COSE_Key for ES256: kty EC2, alg -7, curve P-256, and the point.
  const cosePublicKey = cbor(
    new Map([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, Buffer.from(jwk.x, 'base64url')],
      [-3, Buffer.from(jwk.y, 'base64url')],
    ])
  );

  let counter = 0;

  const authenticatorData = (attested) => {
    counter += 1;
    const flags = Buffer.from([attested ? FLAGS_REGISTER : FLAGS_ASSERT]);
    const count = Buffer.alloc(4);
    count.writeUInt32BE(counter);
    if (!attested) return Buffer.concat([rpIdHash, flags, count]);

    const aaguid = Buffer.alloc(16);
    const idLength = Buffer.alloc(2);
    idLength.writeUInt16BE(credentialId.length);
    return Buffer.concat([rpIdHash, flags, count, aaguid, idLength, credentialId, cosePublicKey]);
  };

  const clientData = (type, challenge, origin) =>
    Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }), 'utf8');

  return {
    id,

    register(challenge, origin) {
      const client = clientData('webauthn.create', challenge, origin);
      const attestationObject = cbor(
        new Map([
          ['fmt', 'none'],
          ['attStmt', new Map()],
          ['authData', authenticatorData(true)],
        ])
      );
      return {
        id,
        rawId: id,
        type: 'public-key',
        clientExtensionResults: {},
        response: {
          clientDataJSON: client.toString('base64url'),
          attestationObject: attestationObject.toString('base64url'),
          transports: ['internal'],
        },
      };
    },

    authenticate(challenge, origin) {
      const client = clientData('webauthn.get', challenge, origin);
      const data = authenticatorData(false);
      // What the spec says gets signed: the authenticator data, then the hash
      // of the client data. Node emits DER, which is what WebAuthn expects.
      const signature = crypto
        .createSign('SHA256')
        .update(Buffer.concat([data, crypto.createHash('sha256').update(client).digest()]))
        .sign(privateKey);

      return {
        id,
        rawId: id,
        type: 'public-key',
        clientExtensionResults: {},
        response: {
          clientDataJSON: client.toString('base64url'),
          authenticatorData: data.toString('base64url'),
          signature: signature.toString('base64url'),
        },
      };
    },

    // Winding the counter back is what a cloned authenticator looks like from
    // the server's side, and the only way to test that it is noticed.
    rewind(to) {
      counter = to;
    },
  };
}

module.exports = { authenticator, cbor };
