require('../config/env');

const db = require('./pool');
const authService = require('../services/authService');

// The last way back in. Everything else needs someone who can already sign in:
// an owner can reset a member's password, and you can change your own. If the
// only owner is locked out, neither helps — so this exists for whoever holds
// DATABASE_URL, which is the honest boundary anyway. Anyone with the database
// can already read and change every row in it.
//
//   npm run reset-password -- <username> [new password]
//
// With no password given, one is generated and printed.
//
// Passkeys go too. A new password is no use on an account whose second factor
// lives on a phone at the bottom of a lake, and this is the one place with the
// standing to say so — it already requires the database.

function generated() {
  // Unambiguous alphabet: no 0/O or 1/l to misread when typing it back in.
  const alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(
    require('crypto').randomBytes(16),
    (byte) => alphabet[byte % alphabet.length]
  ).join('');
}

async function main() {
  const [username, given] = process.argv.slice(2);

  if (!username) {
    const users = await db.all('SELECT username FROM users ORDER BY id');
    console.log('\nUsage: npm run reset-password -- <username> [new password]\n');
    console.log(
      users.length ? `Accounts: ${users.map((u) => u.username).join(', ')}\n` : 'No accounts yet.\n'
    );
    process.exitCode = 1;
    return;
  }

  const user = await authService.findUser(username);
  if (!user) {
    throw new Error(`No account called "${username}".`);
  }

  const password = given || generated();
  if (password.length < 8) {
    throw new Error('Password must be at least 8 characters.');
  }

  // Also ends every session that user had, so a password reset actually
  // locks out whatever was already signed in.
  await authService.setPassword(user.id, password);

  const keys = await db.get('SELECT COUNT(*) AS count FROM credentials WHERE user_id = ?', [
    user.id,
  ]);
  await db.run('DELETE FROM credentials WHERE user_id = ?', [user.id]);
  await db.run('DELETE FROM recovery_codes WHERE user_id = ?', [user.id]);
  await db.run('DELETE FROM login_challenges WHERE user_id = ?', [user.id]);

  console.log(`\n  Password for ${user.username} is now:\n\n      ${password}\n`);
  console.log('  Every device signed in as them has been signed out.');
  if (keys.count > 0) {
    console.log(
      `  ${keys.count} passkey${keys.count === 1 ? '' : 's'} removed — sign in with the password ` +
        'above, then add a new one from Settings.'
    );
  }
  console.log('');
}

main()
  .then(() => db.end())
  .catch(async (err) => {
    console.error(`\n  ${err.message}\n`);
    await db.end().catch(() => {});
    process.exit(1);
  });
