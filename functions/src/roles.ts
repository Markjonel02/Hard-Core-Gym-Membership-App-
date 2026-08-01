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

/** Callable: promote or demote an account. Admin-only, enforced on the token, not the client. */
export async function assignRole(request: CallableRequest<{ uid?: string; role?: string }>) {
  const callerRole = request.auth?.token.role as Role | undefined;
  if (callerRole !== 'admin') {
    throw new HttpsError('permission-denied', 'Only an admin can change roles.');
  }

  // Enforced here rather than in index.ts so it lands *after* the admin check — otherwise a
  // rejected caller could burn through a real admin's allowance just by spamming the endpoint.
  await enforceRateLimit(SET_ROLE_LIMIT, request.auth!.uid);

  const { uid, role } = request.data ?? {};
  if (!uid) throw new HttpsError('invalid-argument', 'uid is required.');
  if (!role || !ROLES.includes(role as Role)) {
    throw new HttpsError('invalid-argument', `role must be one of ${ROLES.join(', ')}.`);
  }
  if (uid === request.auth?.uid && role !== 'admin') {
    // Without this, the last admin could lock everyone out of the admin dashboard.
    throw new HttpsError('failed-precondition', 'You cannot demote your own account.');
  }

  const auth = getAuth();
  const db = getFirestore();

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
