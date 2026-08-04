/**
 * Usernames: reservation, availability, and username -> email resolution for sign-in.
 *
 * Firebase Auth has no concept of a username, so this is built on top of it. The design
 * constraint that shapes everything below: sign-in must resolve a username to an email
 * *before* the user is authenticated, so that lookup has to be readable by an anonymous
 * client. See the security note on `lookupEmailByUsername`.
 *
 * The validation rules themselves live in `usernameRules.ts` and are re-exported here, so
 * callers that only need to validate never pull Firestore in.
 */
import { doc, getDoc, runTransaction, serverTimestamp } from 'firebase/firestore';

import { db } from '@/lib/firebase';
import { ref } from '@/lib/firestore';
import {
  canonicalizeUsername,
  looksLikeEmail,
  usernameSeed,
  validateUsername,
} from '@/lib/usernameRules';

// Re-exported so callers can keep importing everything username-related from one place.
export {
  canonicalizeUsername,
  looksLikeEmail,
  validateUsername,
  MAX_LENGTH,
  MIN_LENGTH,
  USERNAME_HINT,
} from '@/lib/usernameRules';

/**
 * True when the username is free *at the time of the check*.
 *
 * This is for inline form feedback only. Two people can pass this check concurrently and only
 * one will win the reservation, so it is never the thing that guarantees uniqueness — the
 * transactional create in `reserveUsername` is.
 */
export async function isUsernameAvailable(input: string): Promise<boolean> {
  const username = canonicalizeUsername(input);
  const snap = await getDoc(ref.username(username));
  return !snap.exists();
}

export class UsernameTakenError extends Error {
  readonly username: string;

  // Written longhand rather than as a parameter property: those need a full TS compile, and
  // this module is loaded directly by the account-logic test under Node's type stripping.
  constructor(username: string) {
    super('That username is already taken.');
    this.name = 'UsernameTakenError';
    this.username = username;
  }
}

/**
 * Claims `usernames/{username}` for a uid, atomically.
 *
 * The transaction is what makes this safe under a race: two simultaneous signups for the same
 * name both read "missing", both try to create, and Firestore aborts the loser. The rules
 * additionally forbid update/delete on this collection, so a claim cannot be reassigned by a
 * client — an existing doc owned by someone else is a hard stop, not something to overwrite.
 */
export async function reserveUsername(params: {
  username: string;
  uid: string;
  email: string;
}): Promise<void> {
  const username = canonicalizeUsername(params.username);
  const docRef = ref.username(username);

  await runTransaction(db, async (tx) => {
    const existing = await tx.get(docRef);

    if (existing.exists()) {
      // Idempotency: a retried signup for the same account should succeed, not report the
      // user's own name as taken.
      if (existing.get('uid') === params.uid) return;
      throw new UsernameTakenError(username);
    }

    tx.set(docRef, {
      username,
      uid: params.uid,
      email: params.email.trim().toLowerCase(),
      createdAt: serverTimestamp(),
    });
  });
}

/**
 * Resolves a username to the email its account signs in with. Null when no such username.
 *
 * SECURITY NOTE — this read is intentionally public, and that is a real trade-off:
 * anyone can map a username to an email address. It is unavoidable for username sign-in on a
 * client-only Firebase app, because the client must know which email to hand to
 * `signInWithEmailAndPassword` before any credential exists to authorise the lookup.
 *
 * The exposure is bounded to (username -> email) and nothing else: this collection holds no
 * name, phone, membership, or payment data, and knowing the email does not help an attacker
 * past the password. `sign-in.tsx` deliberately reports a wrong username and a wrong password
 * with the same message so this cannot be used as an account-existence oracle through the UI.
 *
 * The alternative — a callable Function doing the lookup server-side — hides the mapping from
 * casual scraping but is still an oracle to anyone who calls it, and it puts a cold start in
 * front of every sign-in. If that trade stops being acceptable, this is the seam to move.
 */
export async function lookupEmailByUsername(input: string): Promise<string | null> {
  const username = canonicalizeUsername(input);
  const snap = await getDoc(doc(db, 'usernames', username));
  if (!snap.exists()) return null;
  const email = snap.get('email');
  return typeof email === 'string' && email ? email : null;
}

/**
 * Turns whatever the user typed in the sign-in box into an email address.
 * Unknown usernames return null so the caller can show the generic credential error.
 */
export async function resolveSignInEmail(identifier: string): Promise<string | null> {
  const trimmed = identifier.trim();
  if (!trimmed) return null;
  if (looksLikeEmail(trimmed)) return trimmed.toLowerCase();
  return lookupEmailByUsername(trimmed);
}

/**
 * Suggests `juan.delacruz`, then `juan.delacruz1`, `juan.delacruz2`… until one is free.
 * Purely a convenience for the signup form; the user can always type their own.
 */
export async function suggestUsername(firstName: string, lastName: string): Promise<string> {
  const base = usernameSeed(firstName, lastName);
  if (!base) return '';
  if (await isUsernameAvailable(base)) return base;

  for (let n = 1; n <= 20; n += 1) {
    const candidate = `${base}${n}`;
    if (validateUsername(candidate)) continue;
    if (await isUsernameAvailable(candidate)) return candidate;
  }
  return '';
}
