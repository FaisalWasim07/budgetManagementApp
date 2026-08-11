const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

// Local development reads a .env file; on a host the variables are already in
// the environment and this finds nothing, which is correct. Checked in both the
// repository root and server/ so it doesn't matter which one you create.
const roots = [
  path.join(__dirname, '..', '..', '..'), // repository root
  path.join(__dirname, '..', '..'), // server/
];

// The file is decoded here rather than left to dotenv, which assumes UTF-8. On
// Windows a .env is easily saved as UTF-16 — PowerShell's `>` and Out-File do
// it by default — and the result is a file that plainly contains the right
// text, is named correctly, and yields nothing at all. That failure is
// invisible from the outside, so the encodings are handled instead.
function decode(buffer) {
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return buffer.subarray(2).toString('utf16le');
  if (buffer[0] === 0xfe && buffer[1] === 0xff) return buffer.subarray(2).swap16().toString('utf16le');
  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.subarray(3).toString('utf8');
  }
  return buffer.toString('utf8');
}

// What each file contributed, so `npm run db:test` can show whether a .env was
// found at all instead of leaving you to infer it from a missing variable.
const loaded = [];

for (const root of roots) {
  const file = path.join(root, '.env');
  if (!fs.existsSync(file)) continue;

  try {
    const parsed = dotenv.parse(decode(fs.readFileSync(file)));
    const applied = [];
    for (const [key, value] of Object.entries(parsed)) {
      // A real environment variable always wins, matching dotenv's own rule.
      if (process.env[key] === undefined) {
        process.env[key] = value;
        applied.push(key);
      }
    }
    loaded.push({ file, keys: Object.keys(parsed), applied });
  } catch (err) {
    loaded.push({ file, error: err.message });
  }
}

module.exports = { loaded };
