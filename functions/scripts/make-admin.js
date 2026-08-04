/**
 * Bootstraps the first admin (or staff) account.
 *
 * The `setRole` callable cannot do this: it rejects any caller whose token is not already
 * `role: 'admin'`, so on a fresh project there is nobody who can promote the first person.
 * That check is correct — it is what stops a member from promoting themselves — so the first
 * admin has to be minted out-of-band, with the Admin SDK, which bypasses rules and claims.
 *
 * The Firebase console cannot do it either: custom claims are not editable from the UI, and
 * editing `users/{uid}.role` there is not enough on its own — firestore.rules reads the role
 * off the *token*, not the document. This script writes both.
 *
 * Usage, from the functions/ directory:
 *   node scripts/make-admin.js owner@example.com
 *   node scripts/make-admin.js owner@example.com --role=staff
 *   node scripts/make-admin.js owner@example.com --verify-email
 *   node scripts/make-admin.js --list
 *
 * Credentials: point GOOGLE_APPLICATION_CREDENTIALS at a service-account JSON key, or drop
 * the key at functions/serviceAccountKey.json (already gitignored).
 */

const { existsSync } = require('node:fs');
const { resolve } = require('node:path');

const { initializeApp, cert, applicationDefault } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { FieldValue, getFirestore } = require('firebase-admin/firestore');

const ROLES = ['member', 'staff', 'admin'];
const KEY_PATH = resolve(__dirname, '..', 'serviceAccountKey.json');

function parseArgs(argv) {
  const flags = new Set();
  const options = {};
  const positional = [];

  for (const arg of argv) {
    if (arg.startsWith('--')) {
      const [name, value] = arg.slice(2).split('=');
      if (value === undefined) flags.add(name);
      else options[name] = value;
    } else {
      positional.push(arg);
    }
  }

  return { flags, options, positional };
}

function credential() {
  // An explicit env var wins: it is how CI and `gcloud auth application-default` both work.
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return applicationDefault();
  if (existsSync(KEY_PATH)) return cert(require(KEY_PATH));

  console.error(
    [
      'No Admin SDK credentials found.',
      '',
      'Firebase console -> Project settings -> Service accounts -> Generate new private key,',
      `then save the downloaded file as:  ${KEY_PATH}`,
      '',
      'That file is a full-access key to the project. It is gitignored — keep it off email,',
      'chat, and screenshots, and delete it once the first admin exists.',
    ].join('\n')
  );
  process.exit(1);
}

/** Accepts an email or a raw uid so this works even before a profile doc exists. */
async function findUser(auth, identifier) {
  if (identifier.includes('@')) return auth.getUserByEmail(identifier.trim().toLowerCase());
  return auth.getUser(identifier);
}

async function listUsers(auth) {
  const { users } = await auth.listUsers(50);

  if (users.length === 0) {
    console.log('No accounts exist yet. Sign up in the app first, then re-run this.');
    return;
  }

  console.log(`${users.length} account(s):\n`);
  for (const user of users) {
    const role = user.customClaims?.role ?? '(none)';
    const verified = user.emailVerified ? 'verified' : 'UNVERIFIED';
    console.log(`  ${user.email ?? '(no email)'}`);
    console.log(`    uid: ${user.uid}   role: ${role}   email: ${verified}`);
  }
}

async function main() {
  const { flags, options, positional } = parseArgs(process.argv.slice(2));
  const listing = flags.has('list');

  // Arguments are checked before credentials on purpose: a mistyped command should say so,
  // not send the reader off to generate a service-account key they may already have.
  const identifier = positional[0];
  if (!listing && !identifier) {
    console.error('Usage: node scripts/make-admin.js <email|uid> [--role=admin|staff] [--verify-email]');
    console.error('       node scripts/make-admin.js --list');
    process.exit(1);
  }

  const role = options.role ?? 'admin';
  if (!ROLES.includes(role)) {
    console.error(`--role must be one of: ${ROLES.join(', ')}`);
    process.exit(1);
  }

  initializeApp({ credential: credential() });
  const auth = getAuth();
  const db = getFirestore();

  if (listing) {
    await listUsers(auth);
    return;
  }

  let user;
  try {
    user = await findUser(auth, identifier);
  } catch (error) {
    if (error.code === 'auth/user-not-found') {
      console.error(`No account for "${identifier}". Sign up in the app first, then re-run this.`);
      console.error('Run with --list to see which accounts exist.');
      process.exit(1);
    }
    throw error;
  }

  // Preserve any other claims already on the account; only `role` is ours to change here.
  await auth.setCustomUserClaims(user.uid, { ...user.customClaims, role });

  // Mirrored into the profile doc so the UI can render the right tabs before the token
  // refreshes. The claim above is the authoritative copy that firestore.rules enforces.
  await db.doc(`users/${user.uid}`).set(
    { role, roleUpdatedAt: FieldValue.serverTimestamp(), roleUpdatedBy: 'make-admin-script' },
    { merge: true }
  );

  // Without this the old token stays valid for up to an hour, and the app would keep
  // showing member tabs while the rules already treat the account as an admin.
  await auth.revokeRefreshTokens(user.uid);

  console.log(`${user.email ?? user.uid} is now ${role}.`);

  if (flags.has('verify-email')) {
    // Deliberately opt-in. The signup flow gates on a real confirmation link; flipping this
    // by hand is a bootstrap shortcut for the owner's own account, not a way around the gate.
    await auth.updateUser(user.uid, { emailVerified: true });
    console.log('Email marked verified, so the verification gate will let this account through.');
  } else if (!user.emailVerified) {
    console.log('');
    console.log('Note: this account is not email-verified, so the app will still hold it at the');
    console.log('confirmation screen. Re-run with --verify-email to clear that for this account.');
  }

  console.log('');
  console.log('Sign out and sign back in — the new role lands with the fresh token.');
}

main().catch((error) => {
  console.error('Failed:', error.message ?? error);
  process.exit(1);
});
