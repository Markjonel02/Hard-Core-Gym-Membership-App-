/**
 * Username rules — the pure half of `lib/username.ts`.
 *
 * Kept free of any Firebase import so the signup form can validate keystrokes without pulling
 * Firestore into the module graph, and so these rules can be exercised by a plain Node test.
 * Anything that touches the network (availability, reservation, lookup) lives in `username.ts`.
 */

/**
 * 3-20 chars, starts with a letter, then letters/digits/underscore/period.
 *
 * No leading digit (keeps usernames distinguishable from ids), no trailing separator, and no
 * consecutive separators — `j..doe` and `j_.doe` read as typos and invite impersonation.
 */
const USERNAME_RE = /^[a-z][a-z0-9]*(?:[._][a-z0-9]+)*$/;

export const MIN_LENGTH = 3;
export const MAX_LENGTH = 20;

/**
 * Names that must not be claimable. `admin`/`staff`/`support` because a member holding one can
 * socially engineer other members; the route names because a username shows up in URLs.
 */
const RESERVED = new Set([
  'admin', 'administrator', 'root', 'staff', 'support', 'help', 'security',
  'hardcore', 'hardcoregym', 'gym', 'owner', 'manager', 'billing', 'payment',
  'sign', 'signin', 'signup', 'signout', 'login', 'logout', 'register',
  'member', 'members', 'profile', 'settings', 'dashboard', 'scan', 'checkin',
  'api', 'auth', 'null', 'undefined', 'me', 'you', 'test',
]);

/** Usernames are stored and compared lowercased; `JuanDC` and `juandc` are the same account. */
export function canonicalizeUsername(input: string): string {
  return input.trim().toLowerCase();
}

/** Returns an error message for display, or null when the username is acceptable. */
export function validateUsername(input: string): string | null {
  const username = canonicalizeUsername(input);

  if (!username) return 'Username is required';
  if (username.length < MIN_LENGTH) return `Use at least ${MIN_LENGTH} characters`;
  if (username.length > MAX_LENGTH) return `Use at most ${MAX_LENGTH} characters`;
  if (username.includes('@')) return 'Usernames cannot contain @ — that looks like an email';
  if (/^\d/.test(username)) return 'Start with a letter';
  if (!USERNAME_RE.test(username)) {
    return 'Letters, numbers, . and _ only — no spaces, and not ending in . or _';
  }
  if (RESERVED.has(username)) return 'That username is not available';

  return null;
}

/** An identifier containing @ is treated as an email; everything else is a username. */
export function looksLikeEmail(identifier: string): boolean {
  return identifier.includes('@');
}

/**
 * Builds the `juan.delacruz` seed that `suggestUsername` appends digits to.
 * Returns '' when the name yields nothing claimable — accented or single-character names can.
 */
export function usernameSeed(firstName: string, lastName: string): string {
  const base = canonicalizeUsername(`${firstName}.${lastName}`)
    .replace(/[^a-z0-9._]/g, '')
    .replace(/[._]{2,}/g, '.')
    .replace(/^[^a-z]+/, '')
    .replace(/[._]+$/, '')
    .slice(0, MAX_LENGTH - 2)
    // The slice can re-expose a trailing separator, which the regex rejects.
    .replace(/[._]+$/, '');

  return validateUsername(base) ? '' : base;
}

export const USERNAME_HINT = 'You can sign in with this or your email.';
