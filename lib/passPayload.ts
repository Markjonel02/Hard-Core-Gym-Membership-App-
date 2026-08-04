/**
 * The QR payload contract, on its own with no Firebase or AsyncStorage behind it.
 *
 * Split out of `nonMembers.ts` for the same reason `usernameRules.ts` was split out of
 * `username.ts`: this is the part worth pinning with assertions, and it can only be loaded
 * directly by the verification script under Node's type stripping if it drags no native or
 * platform modules along with it. `nonMembers.ts` re-exports all of this, so callers keep
 * importing from one place.
 *
 * Security posture, stated plainly: the name in a walk-in pass is self-asserted. Nothing verifies
 * it, because there is no credential to verify it against. Acceptable for an attendance log —
 * the gym wants to know how busy Tuesday was — and not acceptable for anything gating access or
 * money. Member passes are different: they carry only a `memberId`, and the scanner resolves the
 * real record from Firestore.
 */
// Relative, with the extension written out, rather than the usual `@/lib/names`: this module is
// loaded directly by scripts/verify-pass-payload.ts under `node --experimental-strip-types`,
// which resolves real file paths and knows nothing about the tsconfig alias.
import { composeFullName, normalizeNameParts } from './names.ts';

/** Bumped only if the payload shape changes incompatibly; the scanner rejects other versions. */
export const PASS_TAG = 'hardcore-gym';
export const PASS_VERSION = 1;

export type NonMemberPassIdentity = {
  id: string;
  firstName: string;
  middleName?: string | null;
  lastName: string;
};

export type ParsedPass =
  | { kind: 'member'; memberId: string }
  | { kind: 'nonmember'; nonMember: Required<NonMemberPassIdentity> };

/** The QR payload for an existing member. Only the id travels; the scanner resolves the rest. */
export function buildMemberPass(memberId: string): string {
  return JSON.stringify({ t: PASS_TAG, v: PASS_VERSION, kind: 'member', memberId });
}

/**
 * The QR payload for a walk-in. Carries the name because there is no server record to look up
 * yet — the first scan is what creates one.
 */
export function buildNonMemberPass(identity: NonMemberPassIdentity): string {
  const name = normalizeNameParts(identity);
  return JSON.stringify({
    t: PASS_TAG,
    v: PASS_VERSION,
    kind: 'nonmember',
    id: identity.id,
    first: name.firstName,
    middle: name.middleName,
    last: name.lastName,
  });
}

/**
 * Parses a scanned string into a known pass, or null.
 *
 * Returning null for anything unrecognised is the point: a camera pointed at the world sees
 * URLs, WiFi configs and product barcodes, and every one of them reaches this function. Malformed
 * JSON is a normal occurrence here, not an exceptional one, hence the swallowed throw.
 */
export function parsePass(raw: string): ParsedPass | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object') return null;
  const data = parsed as Record<string, unknown>;
  if (data.t !== PASS_TAG || data.v !== PASS_VERSION) return null;

  // Absent `kind` means a pass minted before walk-ins existed, and those were always members.
  const kind = data.kind ?? 'member';

  if (kind === 'member') {
    return typeof data.memberId === 'string' && data.memberId
      ? { kind: 'member', memberId: data.memberId }
      : null;
  }

  if (kind === 'nonmember') {
    const id = typeof data.id === 'string' ? data.id : '';
    const firstName = typeof data.first === 'string' ? data.first : '';
    const lastName = typeof data.last === 'string' ? data.last : '';
    const middleName = typeof data.middle === 'string' ? data.middle : null;
    // A pass with no id cannot be merged into a stable record, and one with no name would log an
    // anonymous row — both are worse than refusing the scan and asking them to re-register.
    if (!id || !firstName || !lastName) return null;
    return { kind: 'nonmember', nonMember: { id, firstName, middleName, lastName } };
  }

  return null;
}

/** Convenience for rendering a scanned walk-in without re-deriving the composed name. */
export function passDisplayName(identity: NonMemberPassIdentity): string {
  return composeFullName(normalizeNameParts(identity));
}
