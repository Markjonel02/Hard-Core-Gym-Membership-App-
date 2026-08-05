/**
 * Issues a member login from the admin screen without disturbing the admin's own session.
 *
 * The problem this solves: `createUserWithEmailAndPassword` does not just create an account, it
 * *signs you in as it*. Calling it on the default Firebase app from the front desk would drop the
 * admin's session and replace it with the brand-new member's — mid-form, with a half-created
 * membership and no way back without re-authenticating.
 *
 * The fix is a second, throwaway Firebase app. It shares the same project and config but keeps
 * its own auth state, so the new account lands there and `lib/firebase.ts`'s `auth` never
 * notices. The app is deleted when the work is done.
 *
 * A useful consequence, not a coincidence: while signed in on the secondary app, `request.auth`
 * *is* the new member. That is exactly what the existing `usernames` and `users` create rules
 * require (`request.resource.data.uid == request.auth.uid`), so this needs no rule changes and
 * no privileged server call — an admin genuinely cannot reserve a username on someone else's
 * behalf, and does not have to.
 *
 * That only holds if the *writes* travel on the secondary app too, which is the trap here. The
 * shared helpers in `lib/firestore.ts` are bound to the default app's `db`, so calling them
 * unchanged sends the reservation over the admin's connection and the rule denies it — the
 * account gets created and immediately rolled back. Hence `getFirestore(secondary)` below, and
 * the explicit `firestore` argument to `reserveUsername`.
 */
import { deleteApp, initializeApp } from 'firebase/app';
import {
  createUserWithEmailAndPassword,
  getAuth,
  sendEmailVerification,
  signOut,
  updateProfile,
} from 'firebase/auth';
import { doc, getFirestore, serverTimestamp, setDoc } from 'firebase/firestore';

import { logAuthError, logAuthSuccess } from '@/lib/authLog';
import { firebaseConfig } from '@/lib/firebase';
import { composeFullName, normalizeNameParts } from '@/lib/names';
import { normalizePhone } from '@/lib/phone';
import {
  canonicalizeUsername,
  isUsernameAvailable,
  reserveUsername,
  UsernameTakenError,
} from '@/lib/username';

export type ProvisionMemberLoginInput = {
  email: string;
  password: string;
  username: string;
  firstName: string;
  middleName?: string | null;
  lastName: string;
  phone: string;
};

/**
 * Creates the login and returns its uid, so the caller can link the member doc to it.
 *
 * Throws on anything that would leave the member unable to sign in — a taken username, a
 * rejected email, a weak password. The caller must not write a member document until this
 * resolves: a membership pointing at a login that failed to exist is the harder mess to unpick.
 */
export async function provisionMemberLogin(
  input: ProvisionMemberLoginInput
): Promise<{ uid: string }> {
  const username = canonicalizeUsername(input.username);
  const email = input.email.trim().toLowerCase();
  const name = normalizeNameParts(input);
  const displayName = composeFullName(name);
  const phone = normalizePhone(input.phone) ?? input.phone.trim();

  /*
   * Checked before the account exists, for the same reason sign-up does it: a login created and
   * then denied its username is a dead end — retrying reports `auth/email-already-in-use`, and
   * only the gym can clear it. Failing open on a *broken* check is deliberate; `reserveUsername`
   * below is transactional and is what actually enforces uniqueness.
   */
  let taken = false;
  try {
    taken = !(await isUsernameAvailable(username));
  } catch (error) {
    logAuthError('provision (username availability check failed)', error);
  }
  if (taken) {
    const error = new UsernameTakenError(username);
    logAuthError('provision (username taken)', error);
    throw error;
  }

  /*
   * A unique app name per call. Reusing one fixed name would collide with a still-closing app
   * from a previous provision — Firebase throws on a duplicate name — and the front desk creating
   * two members in quick succession is the normal case, not the edge one.
   */
  const secondary = initializeApp(firebaseConfig, `provisioning-${username}-${Date.now()}`);
  const secondaryAuth = getAuth(secondary);
  const secondaryDb = getFirestore(secondary);

  try {
    let cred;
    try {
      cred = await createUserWithEmailAndPassword(secondaryAuth, email, input.password);
    } catch (error) {
      logAuthError('provision (create account)', error);
      throw error;
    }

    logAuthSuccess('provision', cred.user.uid);

    // Rolled back on failure, exactly as sign-up does: better no account than one whose
    // username never stuck, because the member was just handed credentials that would not work.
    try {
      await reserveUsername({ username, uid: cred.user.uid, email, firestore: secondaryDb });
    } catch (error) {
      logAuthError('provision (reserve username)', error);
      try {
        await cred.user.delete();
        console.warn('[auth] rolled back the provisioned login so it can be retried');
      } catch (rollbackError) {
        logAuthError('provision (rollback after failed reservation)', rollbackError);
      }
      throw error;
    }

    // Past this point the login works. The remaining writes are follow-up: a failure must not
    // read as "provisioning failed", and the onUserCreate trigger writes this doc server-side too.
    // Same secondary-app requirement as the reservation — the `users` create rule is scoped to
    // `request.auth.uid == uid`, so the admin's connection cannot write the new member's profile.
    try {
      await setDoc(
        doc(secondaryDb, 'users', cred.user.uid),
        {
          uid: cred.user.uid,
          email: cred.user.email ?? email,
          username,
          firstName: name.firstName,
          middleName: name.middleName,
          lastName: name.lastName,
          displayName,
          phone,
          // Mirrored so the UI can render member tabs immediately. Not the authoritative copy:
          // firestore.rules reads the role off the *token*, and the create rule only permits
          // 'member' here, so this cannot self-promote. The token's claim is normally stamped by
          // the onUserCreate trigger, which is undeployed — hence the matching default in
          // `role()` in firestore.rules, without which this account could not read its own
          // membership at all.
          role: 'member',
          emailOptIn: true,
          createdAt: serverTimestamp(),
        },
        { merge: true }
      );
    } catch (error) {
      logAuthError('provision (write users doc)', error);
    }

    try {
      await updateProfile(cred.user, { displayName });
    } catch (error) {
      logAuthError('provision (set display name)', error);
    }

    /*
     * Verification stays required for admin-created logins, so this email is the member's only
     * way past the `/verify-email` gate. A failure here is recoverable — that screen has a
     * Resend button — so it is logged rather than thrown, but the admin is told to expect it.
     */
    try {
      await sendEmailVerification(cred.user);
      console.log('[auth] verification email dispatched to the new member');
    } catch (error) {
      logAuthError('provision (send verification email)', error);
    }

    return { uid: cred.user.uid };
  } finally {
    /*
     * Always runs, including on the throw paths above. Signing out first is belt-and-braces: the
     * session lives on the secondary app and dies with it, but leaving a signed-in auth instance
     * attached to a deleted app has caused stray token-refresh noise in the console.
     */
    try {
      await signOut(secondaryAuth);
    } catch (error) {
      logAuthError('provision (sign out secondary app)', error);
    }
    try {
      await deleteApp(secondary);
    } catch (error) {
      logAuthError('provision (delete secondary app)', error);
    }
  }
}
