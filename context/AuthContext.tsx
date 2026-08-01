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
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  onIdTokenChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import { onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';

import { auth } from '@/lib/firebase';
import { logAuthAttempt, logAuthError, logAuthSuccess } from '@/lib/authLog';
import { q, ref, withId } from '@/lib/firestore';
import type { Member, Role, UserDoc } from '@/types/models';

type AuthState = {
  user: User | null;
  profile: UserDoc | null;
  /** Read from the ID token custom claim, falling back to the users doc. */
  role: Role | null;
  member: Member | null;
  /** True until the first auth resolution completes; gates the splash screen. */
  loading: boolean;
  isStaff: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (name: string, email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  refreshRole: () => Promise<void>;
};

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserDoc | null>(null);
  const [claimRole, setClaimRole] = useState<Role | null>(null);
  const [member, setMember] = useState<Member | null>(null);
  const [loading, setLoading] = useState(true);

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

  const signIn = useCallback(async (email: string, password: string) => {
    logAuthAttempt('sign-in', email);
    try {
      const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
      logAuthSuccess('sign-in', cred.user.uid);
    } catch (error) {
      logAuthError('sign-in', error);
      throw error;
    }
  }, []);

  const signUp = useCallback(async (name: string, email: string, password: string) => {
    logAuthAttempt('sign-up', email);

    let cred;
    try {
      cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
    } catch (error) {
      logAuthError('sign-up (create account)', error);
      throw error;
    }

    logAuthSuccess('sign-up', cred.user.uid);

    // The account exists at this point. The two writes below are follow-up work, so a
    // failure here must not read as "signup failed" — it is logged and swallowed, and the
    // onUserCreate trigger writes the same doc server-side anyway.
    try {
      await updateProfile(cred.user, { displayName: name.trim() });
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
          email: cred.user.email ?? email.trim(),
          displayName: name.trim(),
          emailOptIn: true,
          createdAt: serverTimestamp(),
        },
        { merge: true }
      );
    } catch (error) {
      logAuthError('sign-up (write users doc)', error);
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

  const role = claimRole ?? profile?.role ?? null;

  const value = useMemo<AuthState>(
    () => ({
      user,
      profile,
      role,
      member,
      loading,
      isStaff: role === 'staff' || role === 'admin',
      signIn,
      signUp,
      signOut,
      resetPassword,
      refreshRole,
    }),
    [user, profile, role, member, loading, signIn, signUp, signOut, resetPassword, refreshRole]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
