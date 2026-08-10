const fs = require('fs');
const path = require('path');

// Local development reads a .env file; on a host the variables are already in
// the environment and this finds nothing, which is correct. Checked in both the
// repository root and server/ so it doesn't matter which one you create.
const roots = [
  path.join(__dirname, '..', '..', '..'), // repository root
  path.join(__dirname, '..', '..'), // server/
];

for (const root of roots) {
  const file = path.join(root, '.env');
  if (fs.existsSync(file)) {
    require('dotenv').config({ path: file, quiet: true });
  }
}
