/**
 * Walk-in passes: id minting and local persistence.
 *
 * A non-member has no account and no Firestore write access, so their pass has to be
 * self-contained: the id and name travel inside the QR itself, and the *staff* client is what
 * turns a scan into a `nonMembers` document. That is the whole reason this seam exists — both the
 * visitor's device (which produces the code) and the scanner (which consumes it) agree on one
 * payload shape rather than each hand-rolling its own JSON.
 *
 * The payload codec itself lives in `lib/passPayload.ts`, so it can be asserted against without
 * loading Firebase or AsyncStorage, and is re-exported here so callers still import from one
 * place.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { doc } from 'firebase/firestore';

import { col } from '@/lib/firestore';
import type { NonMemberPassIdentity } from '@/lib/passPayload';

export {
  buildMemberPass,
  buildNonMemberPass,
  parsePass,
  passDisplayName,
  PASS_TAG,
  PASS_VERSION,
} from '@/lib/passPayload';
export type { NonMemberPassIdentity, ParsedPass } from '@/lib/passPayload';

const STORAGE_KEY = 'hardcore-gym/nonmember-pass/v1';

/**
 * A fresh walk-in id, generated entirely on-device.
 *
 * `doc()` on a collection reference mints a random id locally — no network round trip and no
 * auth — which is exactly what an unauthenticated visitor's phone needs. Nothing is written to
 * Firestore here; the id is just reserved for the QR.
 */
export function newNonMemberId(): string {
  return doc(col.nonMembers()).id;
}

/**
 * Remembers the pass on the visitor's own device.
 *
 * Without this, reopening the modal would mint a new id and the same person would accumulate a
 * fresh `nonMembers` row per visit, making the attendance log count unique visitors wrongly.
 * Failures are swallowed and logged: a walk-in who cannot persist their pass should still be
 * shown a working QR right now, which is the thing they are standing at the desk to get.
 */
export async function saveLocalPass(identity: Required<NonMemberPassIdentity>): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
  } catch (error) {
    console.warn('[nonmember] could not persist the local pass', error);
  }
}

export async function loadLocalPass(): Promise<Required<NonMemberPassIdentity> | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<NonMemberPassIdentity>;
    if (!parsed?.id || !parsed.firstName || !parsed.lastName) return null;
    return {
      id: parsed.id,
      firstName: parsed.firstName,
      middleName: parsed.middleName ?? null,
      lastName: parsed.lastName,
    };
  } catch (error) {
    console.warn('[nonmember] could not read the local pass', error);
    return null;
  }
}

export async function clearLocalPass(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.warn('[nonmember] could not clear the local pass', error);
  }
}
