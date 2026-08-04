import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import { FirebaseError } from 'firebase/app';
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  onIdTokenChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import { onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';

import { auth } from '@/lib/firebase';
import { logAuthAttempt, logAuthError, logAuthSuccess } from '@/lib/authLog';
import { composeFullName, normalizeNameParts } from '@/lib/names';
import { normalizePhone } from '@/lib/phone';
import { canonicalizeUsername, isUsernameAvailable, reserveUsername, resolveSignInEmail, UsernameTakenError } from '@/lib/username';
import { q, ref, withId } from '@/lib/firestore';
import type { Member, Role, UserDoc } from '@/types/models';

export type SignUpInput = {
  username: string;
  firstName: string;
  middleName?: string;
  lastName: string;
  email: string;
  phone: string;
  password: string;
};

type AuthState = {
  user: User | null;
  profile: UserDoc | null;
  /** Read from the ID token custom claim, falling back to the users doc. */
  role: Role | null;
  member: Member | null;
  /** True until the first auth resolution completes; gates the splash screen. */
  loading: boolean;
  isStaff: boolean;
  /**
   * Mirrors `user.emailVerified`, held in state because the Firebase User object is mutated
   * in place on reload — reading it directly would not re-render the verification gate.
   */
  emailVerified: boolean;
  /** Accepts a username or an email; usernames are resolved to their email first. */
  signIn: (identifier: string, password: string) => Promise<void>;
  signUp: (input: SignUpInput) => Promise<void>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  refreshRole: () => Promise<void>;
  /** Re-fetches the user from Firebase; returns true once the address is confirmed. */
  reloadUser: () => Promise<boolean>;
  resendVerificationEmail: () => Promise<void>;
};

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserDoc | null>(null);
  const [claimRole, setClaimRole] = useState<Role | null>(null);
  const [member, setMember] = useState<Member | null>(null);
  const [loading, setLoading] = useState(true);
  const [emailVerified, setEmailVerified] = useState(false);

  // Cleanup handles for the per-user Firestore listeners.
  const profileUnsub = useRef<(() => void) | null>(null);
  const memberUnsub = useRef<(() => void) | null>(null);

  const detach = useCallback(() => {
    profileUnsub.current?.();
    memberUnsub.current?.();
    profileUnsub.current = null;
    memberUnsub.current = null;
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (next) => {
      detach();
      setUser(next);
      setEmailVerified(next?.emailVerified ?? false);

      if (!next) {
        setProfile(null);
        setMember(null);
        setClaimRole(null);
        setLoading(false);
        return;
      }

      // The onUserCreate function writes users/{uid} and sets the claim, but the client may
      // arrive first on a brand-new signup. Read the claim, then listen for the doc to land.
      try {
        const token = await next.getIdTokenResult();
        const role = token.claims.role;
        if (role === 'member' || role === 'staff' || role === 'admin') setClaimRole(role);
      } catch {
        setClaimRole(null);
      }

      profileUnsub.current = onSnapshot(
        ref.user(next.uid),
        (snap) => {
          setProfile(snap.exists() ? ({ ...snap.data(), uid: snap.id } as UserDoc) : null);
          setLoading(false);
        },
        () => setLoading(false)
      );

      memberUnsub.current = onSnapshot(
        q.memberByUid(next.uid),
        (snap) => setMember(snap.empty ? null : withId<Member>(snap.docs[0])),
        () => setMember(null)
      );
    });

    return () => {
      unsub();
      detach();
    };
  }, [detach]);

  // Picks up role changes after an admin promotes an account and the token refreshes.
  useEffect(() => {
    return onIdTokenChanged(auth, async (next) => {
      if (!next) return;
      const token = await next.getIdTokenResult();
      const role = token.claims.role;
      if (role === 'member' || role === 'staff' || role === 'admin') setClaimRole(role);
    });
  }, []);

  const signIn = useCallback(async (identifier: string, password: string) => {
    logAuthAttempt('sign-in', identifier);

    // A username has to become an email before Firebase will look at it. An unknown username
    // is reported as a bad credential rather than "no such user", so the sign-in form cannot
    // be used to enumerate which usernames exist.
    let email: string | null;
    try {
      email = await resolveSignInEmail(identifier);
    } catch (error) {
      // A denied or offline lookup is an infrastructure fault, not something the member did.
      // It is logged in full for us, but it must not reach the UI as its own message: a
      // distinct error here would tell an attacker their username exists but the read failed,
      // and it would tell an ordinary member something they cannot act on. Fall through to
      // the same generic credential error every other failed sign-in produces.
      logAuthError('sign-in (username lookup failed)', error);
      email = null;
    }

    if (!email) {
      const error = new FirebaseError('auth/invalid-credential', 'No account matches that username.');
      logAuthError('sign-in (username lookup)', error);
      throw error;
    }

    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      logAuthSuccess('sign-in', cred.user.uid);
    } catch (error) {
      logAuthError('sign-in', error);
      throw error;
    }
  }, []);

  const signUp = useCallback(async (input: SignUpInput) => {
    logAuthAttempt('sign-up', input.email);

    const username = canonicalizeUsername(input.username);
    const email = input.email.trim().toLowerCase();
    const name = normalizeNameParts(input);
    const displayName = composeFullName(name);
    // Validated by the form; the fallback keeps a bad value out of Firestore either way.
    const phone = normalizePhone(input.phone) ?? input.phone.trim();

    // Checked before the account is created: a claimed username after a successful
    // createUser would leave an orphaned login the user cannot finish setting up.
    //
    // If the check itself errors we let the signup proceed. This is only an early, friendlier
    // rejection — `reserveUsername` below is transactional and is what actually enforces
    // uniqueness, so failing open here costs a clearer error message, not correctness.
    let taken = false;
    try {
      taken = !(await isUsernameAvailable(username));
    } catch (error) {
      logAuthError('sign-up (username availability check failed)', error);
    }

    if (taken) {
      const error = new UsernameTakenError(username);
      logAuthError('sign-up (username taken)', error);
      throw error;
    }

    let cred;
    try {
      cred = await createUserWithEmailAndPassword(auth, email, input.password);
    } catch (error) {
      logAuthError('sign-up (create account)', error);
      throw error;
    }

    logAuthSuccess('sign-up', cred.user.uid);

    // The username reservation is the one post-create step that is allowed to fail loudly.
    // Everything after it is cosmetic, but a signup whose username silently did not stick
    // would leave the user unable to sign in the way the form just told them they could.
    //
    // If it fails, the account is rolled back. Without this the member is stuck: the Auth
    // account exists, so retrying gives them `auth/email-already-in-use`, but they never got
    // a username and cannot sign in the way the form promised — a dead end only the gym can
    // clear. Deleting is safe because this account was created moments ago in this same call.
    try {
      await reserveUsername({ username, uid: cred.user.uid, email });
    } catch (error) {
      logAuthError('sign-up (reserve username)', error);

      try {
        await cred.user.delete();
        console.warn('[auth] rolled back the new account so the signup can be retried');
      } catch (rollbackError) {
        // Nothing more to try — surface the original cause, not the cleanup failure.
        logAuthError('sign-up (rollback after failed reservation)', rollbackError);
      }

      throw error;
    }

    // The account exists at this point. The writes below are follow-up work, so a failure
    // here must not read as "signup failed" — it is logged and swallowed, and the
    // onUserCreate trigger writes the same doc server-side anyway.
    try {
      await updateProfile(cred.user, { displayName });
    } catch (error) {
      logAuthError('sign-up (set display name)', error);
    }

    try {
      // Written client-side too so the profile exists even before the trigger fires.
      // Rules forbid the client from setting `role`, so this cannot self-promote.
      await setDoc(
        ref.user(cred.user.uid),
        {
          uid: cred.user.uid,
          email: cred.user.email ?? email,
          username,
          firstName: name.firstName,
          middleName: name.middleName,
          lastName: name.lastName,
          displayName,
          phone,
          emailOptIn: true,
          createdAt: serverTimestamp(),
        },
        { merge: true }
      );
    } catch (error) {
      logAuthError('sign-up (write users doc)', error);
    }

    // Sending this is what the verification gate waits on. A failure here is recoverable —
    // the pending screen has a Resend button — so it must not undo a valid signup.
    try {
      await sendEmailVerification(cred.user);
      console.log('[auth] verification email dispatched');
    } catch (error) {
      logAuthError('sign-up (send verification email)', error);
    }
  }, []);

  const signOut = useCallback(async () => {
    detach();
    await fbSignOut(auth);
    console.log('[auth] signed out');
  }, [detach]);

  const resetPassword = useCallback(async (email: string) => {
    logAuthAttempt('password-reset', email);
    try {
      await sendPasswordResetEmail(auth, email.trim());
      console.log('[auth] password-reset email dispatched');
    } catch (error) {
      logAuthError('password-reset', error);
      throw error;
    }
  }, []);

  const refreshRole = useCallback(async () => {
    if (!auth.currentUser) return;
    const token = await auth.currentUser.getIdTokenResult(true);
    const role = token.claims.role;
    if (role === 'member' || role === 'staff' || role === 'admin') setClaimRole(role);
  }, []);

  const reloadUser = useCallback(async (): Promise<boolean> => {
    if (!auth.currentUser) return false;
    await auth.currentUser.reload();
    const verified = auth.currentUser.emailVerified;
    setEmailVerified(verified);
    return verified;
  }, []);

  const resendVerificationEmail = useCallback(async () => {
    if (!auth.currentUser) throw new Error('No user signed in.');
    await sendEmailVerification(auth.currentUser);
    console.log('[auth] verification email resent');
  }, []);

  const role = claimRole ?? profile?.role ?? null;

  const value = useMemo<AuthState>(
    () => ({
      user,
      profile,
      role,
      member,
      loading,
      isStaff: role === 'staff' || role === 'admin',
      emailVerified,
      signIn,
      signUp,
      signOut,
      resetPassword,
      refreshRole,
      reloadUser,
      resendVerificationEmail,
    }),
    [
      user,
      profile,
      role,
      member,
      loading,
      emailVerified,
      signIn,
      signUp,
      signOut,
      resetPassword,
      refreshRole,
      reloadUser,
      resendVerificationEmail,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
