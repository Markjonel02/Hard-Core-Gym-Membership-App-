/**
 * Philippine mobile number handling.
 *
 * Members type their number however they normally write it — `0917 123 4567`,
 * `+63 917 123 4567`, `09171234567`. All three are the same number, so they are normalised to
 * one canonical form (`+639171234567`) before storage. Without that, the same person entered
 * twice by two staff members looks like two members, and a search for their number finds one.
 */

/** Digits only, `+` preserved if it leads. */
function strip(input: string): string {
  const trimmed = input.trim();
  const digits = trimmed.replace(/[^\d]/g, '');
  return trimmed.startsWith('+') ? `+${digits}` : digits;
}

/**
 * Returns `+639XXXXXXXXX`, or null if the input is not a PH mobile number.
 *
 * Landlines are deliberately rejected: expiry reminders and check-in confirmations assume a
 * number that can receive SMS, and silently accepting a landline stores a number nobody reads.
 */
export function normalizePhone(input: string): string | null {
  const cleaned = strip(input);

  // 09XXXXXXXXX — the way it is written locally.
  if (/^09\d{9}$/.test(cleaned)) return `+63${cleaned.slice(1)}`;
  // +639XXXXXXXXX — already canonical.
  if (/^\+639\d{9}$/.test(cleaned)) return cleaned;
  // 639XXXXXXXXX — pasted from a system that dropped the plus.
  if (/^639\d{9}$/.test(cleaned)) return `+${cleaned}`;
  // 9XXXXXXXXX — leading zero omitted.
  if (/^9\d{9}$/.test(cleaned)) return `+63${cleaned}`;

  return null;
}

export function isValidPhone(input: string): boolean {
  return normalizePhone(input) !== null;
}

/** `+639171234567` -> `0917 123 4567` for display. Unrecognised input is returned untouched. */
export function formatPhone(stored: string): string {
  const normalized = normalizePhone(stored);
  if (!normalized) return stored;
  const local = `0${normalized.slice(3)}`;
  return `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}`;
}

/** Shown under an empty field, as guidance. */
export const PHONE_HINT = 'Philippine mobile, e.g. 0917 123 4567';

/**
 * Shown when what they typed was rejected. Deliberately different wording from PHONE_HINT:
 * repeating the hint as the error makes an invalid field look like it has no error at all.
 */
export const PHONE_ERROR = 'Enter a mobile number like 0917 123 4567 — landlines cannot receive reminders';
