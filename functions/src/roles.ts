import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';

import { enforceRateLimit, SET_ROLE_LIMIT } from './rateLimit';

export type Role = 'member' | 'staff' | 'admin';

const ROLES: Role[] = ['member', 'staff', 'admin'];

/**
 * Seeds the users/{uid} doc and stamps the default role claim.
 *
 * The claim is the authoritative copy — security rules read it off the token, so promoting
 * someone can't be faked by editing their user document from the client. The mirrored
 * `role` field exists only so the UI can render before the token refreshes.
 */
export async function provisionUser(user: {
  uid: string;
  email?: string;
  displayName?: string;
  photoURL?: string;
}) {
  const db = getFirestore();
  const auth = getAuth();

  await auth.setCustomUserClaims(user.uid, { role: 'member' satisfies Role });

  // Only fields this trigger actually knows about are written. The username, phone, and split
  // name parts come from the signup form and exist solely in the client's write — listing them
  // here as `?? null` would race that write and blank them out whenever the trigger lands second.
  await db.doc(`users/${user.uid}`).set(
    {
      email: user.email ?? null,
      displayName: user.displayName ?? null,
      photoURL: user.photoURL ?? null,
      role: 'member' satisfies Role,
      emailOptIn: true,
      createdAt: FieldValue.serverTimestamp(),
    },
    // Merge: the client writes its own profile row at sign-up, and this trigger can land
    // after that write. Merging keeps the name the user typed instead of nulling it.
    { merge: true }
  );

  logger.info('user provisioned', { uid: user.uid });
}

/**
 * Callable: promote or demote an account. Admin-only, enforced on the token, not the client.
 *
 * Accepts `uid` or `email`. Email is the practical one: the admin settings screen is granting
 * access to a colleague they know by address, and nobody knows anyone's uid. Resolving it here
 * rather than client-side is deliberate — looking up an account by email needs the Admin SDK,
 * and it keeps "is this address even registered?" from being answerable by an unprivileged
 * client. `uid` stays supported for the user-management list, which already has one.
 */
export async function assignRole(
  request: CallableRequest<{ uid?: string; email?: string; role?: string }>
) {
  const callerRole = request.auth?.token.role as Role | undefined;
  if (callerRole !== 'admin') {
    throw new HttpsError('permission-denied', 'Only an admin can change roles.');
  }

  // Enforced here rather than in index.ts so it lands *after* the admin check — otherwise a
  // rejected caller could burn through a real admin's allowance just by spamming the endpoint.
  await enforceRateLimit(SET_ROLE_LIMIT, request.auth!.uid);

  const { uid: rawUid, email, role } = request.data ?? {};
  if (!rawUid && !email) {
    throw new HttpsError('invalid-argument', 'Either uid or email is required.');
  }
  if (!role || !ROLES.includes(role as Role)) {
    throw new HttpsError('invalid-argument', `role must be one of ${ROLES.join(', ')}.`);
  }

  const auth = getAuth();
  const db = getFirestore();

  let uid = rawUid;
  if (!uid && email) {
    try {
      uid = (await auth.getUserByEmail(email.trim().toLowerCase())).uid;
    } catch {
      // Deliberately specific: the admin needs to know the difference between "typo" and
      // "they haven't signed up yet", and this endpoint is already admin-gated.
      throw new HttpsError('not-found', `No account exists for ${email}. Ask them to sign up first.`);
    }
  }

  if (!uid) {
    // Unreachable — the guards above cover both inputs. Present so the rest of the function
    // sees a plain string instead of string | undefined.
    throw new HttpsError('invalid-argument', 'Could not resolve an account to update.');
  }

  if (uid === request.auth?.uid && role !== 'admin') {
    // Without this, the last admin could lock everyone out of the admin dashboard.
    throw new HttpsError('failed-precondition', 'You cannot demote your own account.');
  }

  await auth.setCustomUserClaims(uid, { role });
  await db.doc(`users/${uid}`).set(
    { role, roleUpdatedAt: FieldValue.serverTimestamp(), roleUpdatedBy: request.auth?.uid ?? null },
    { merge: true }
  );

  // Force the next client request to mint a fresh token so the new claim takes effect
  // without waiting up to an hour for the old one to expire.
  await auth.revokeRefreshTokens(uid);

  logger.info('role assigned', { uid, role, by: request.auth?.uid });
  return { ok: true, uid, role };
}
