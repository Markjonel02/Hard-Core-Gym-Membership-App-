import { FirebaseError } from 'firebase/app';

/** Firebase auth error codes are not user-facing; map the common ones to plain language. */
const MESSAGES: Record<string, string> = {
  'auth/invalid-email': 'That email address is not valid.',
  'auth/user-disabled': 'This account has been disabled. Contact the gym front desk.',
  'auth/user-not-found': 'No account found with that email.',
  'auth/wrong-password': 'Incorrect email or password.',
  'auth/invalid-credential': 'Incorrect email or password.',
  'auth/email-already-in-use': 'An account with that email already exists.',
  'auth/weak-password': 'Password is too weak — use at least 8 characters.',
  'auth/too-many-requests': 'Too many attempts. Try again in a few minutes.',
  'auth/network-request-failed': 'Network error. Check your connection and try again.',
  'auth/requires-recent-login': 'Please sign in again to complete this change.',
  // Setup problems. These are not the user's fault, so say so plainly rather than
  // implying they typed something wrong — and point at the console for the details.
  'auth/configuration-not-found':
    'This app is not connected to a Firebase project yet. Check the .env file — see the console for details.',
  'auth/invalid-api-key': 'The Firebase API key is invalid. Check the .env file.',
  'auth/api-key-not-valid': 'The Firebase API key is invalid. Check the .env file.',
  'auth/operation-not-allowed':
    'Email sign-in is not enabled for this Firebase project. Enable it in the Firebase console.',
  'auth/unauthorized-domain': 'This domain is not authorized in the Firebase console.',
  'permission-denied': 'You do not have access to that.',
  // Callable errors arrive as `functions/<code>`. Only the ones whose server-side message is
  // too terse or too internal to show are listed; the rest fall through to error.message below.
  'functions/internal':
    'The server could not complete that. Check that Cloud Functions are deployed, then try again.',
  'functions/unavailable':
    'Could not reach the server. Check your connection, then try again.',
  'functions/unauthenticated': 'Please sign in again and retry.',
  'functions/deadline-exceeded': 'That took too long to finish. Try again in a moment.',
};

export function authErrorMessage(error: unknown): string {
  if (error instanceof FirebaseError) {
    const mapped = MESSAGES[error.code];
    if (mapped) return mapped;
    /**
     * Callables are the one case where the raw message is worth showing: an HttpsError's
     * message is written server-side for this exact admin ("No account exists for …",
     * "You cannot demote your own account"). Collapsing those into a generic sentence is how
     * a wrong-region misconfiguration ends up indistinguishable from a real function bug.
     */
    if (error.code.startsWith('functions/') && error.message) return error.message;
    return 'Something went wrong. Please try again.';
  }
  // UsernameTakenError and friends already carry a sentence written for the user.
  if (error instanceof Error && error.message) return error.message;
  return 'Something went wrong. Please try again.';
}
