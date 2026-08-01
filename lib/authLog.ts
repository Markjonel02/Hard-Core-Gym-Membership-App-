/**
 * Auth diagnostics.
 *
 * When a sign-in or sign-up fails, the user gets a short sentence. That sentence is
 * deliberately vague — telling a stranger "no account found with that email" leaks who
 * has an account here. But the *developer* needs the real reason, so every attempt is
 * logged to the console with the raw Firebase error code intact.
 *
 * Passwords are never accepted by these functions, so they cannot be logged. Emails are
 * masked, because console output ends up in screenshots and bug reports.
 */
import { FirebaseError } from 'firebase/app';

const PREFIX = '[auth]';

/** `juan.delacruz@gmail.com` -> `j***z@gmail.com` — enough to tell two accounts apart. */
export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at < 1) return '***';
  const name = email.slice(0, at);
  const domain = email.slice(at);
  if (name.length <= 2) return `${name[0]}***${domain}`;
  return `${name[0]}***${name[name.length - 1]}${domain}`;
}

/**
 * Codes that mean "the app is misconfigured", not "the user typed something wrong".
 * These are worth shouting about because no amount of retrying will fix them.
 */
const CONFIG_ERRORS: Record<string, string> = {
  'auth/configuration-not-found':
    'The Firebase project behind EXPO_PUBLIC_FIREBASE_API_KEY does not exist, or Email/Password sign-in is not enabled for it.\n' +
    '  1. Firebase console -> Authentication -> Sign-in method -> enable Email/Password.\n' +
    '  2. Confirm .env matches Project settings -> General -> Your apps -> Web app.',
  'auth/invalid-api-key': 'EXPO_PUBLIC_FIREBASE_API_KEY is malformed. Re-copy it from the Firebase console.',
  'auth/api-key-not-valid': 'EXPO_PUBLIC_FIREBASE_API_KEY was rejected by Google. Re-copy it from the Firebase console.',
  'auth/app-not-authorized': 'This domain is not in Firebase Authentication -> Settings -> Authorized domains.',
  'auth/operation-not-allowed':
    'Email/Password sign-in is disabled. Firebase console -> Authentication -> Sign-in method.',
  'auth/unauthorized-domain':
    'Add this origin under Firebase Authentication -> Settings -> Authorized domains.',
};

export function isConfigError(code: string): boolean {
  return code in CONFIG_ERRORS;
}

export function logAuthAttempt(action: string, email: string): void {
  console.log(`${PREFIX} ${action} attempt for ${maskEmail(email)}`);
}

export function logAuthSuccess(action: string, uid: string): void {
  console.log(`${PREFIX} ${action} succeeded (uid ${uid.slice(0, 6)}…)`);
}

/** Config hints repeat identically on every attempt; log each one once per session. */
const hintedCodes = new Set<string>();

/**
 * Logs the real cause. Returns nothing — callers still show the friendly message from
 * authErrorMessage(); this exists purely so the reason is visible in the console.
 *
 * Everything here uses console.warn rather than console.error on purpose. A failed sign-in
 * is a *handled* outcome: the screen already shows the user what went wrong. console.error
 * raises Expo's full-screen LogBox overlay, which covers the very form you are trying to
 * fix and has to be dismissed on every attempt. The log text is identical either way.
 */
export function logAuthError(action: string, error: unknown): void {
  if (error instanceof FirebaseError) {
    console.warn(`${PREFIX} ${action} failed — code: ${error.code}`);
    console.warn(`${PREFIX} raw message: ${error.message}`);

    const hint = CONFIG_ERRORS[error.code];
    if (hint && !hintedCodes.has(error.code)) {
      hintedCodes.add(error.code);
      console.warn(`${PREFIX} This is a configuration problem, not a bad password:\n  ${hint}`);
    }
    return;
  }

  if (error instanceof Error) {
    console.warn(`${PREFIX} ${action} failed — ${error.name}: ${error.message}`);
    if (error.stack) console.warn(error.stack);
    return;
  }

  console.warn(`${PREFIX} ${action} failed with a non-Error value:`, error);
}
