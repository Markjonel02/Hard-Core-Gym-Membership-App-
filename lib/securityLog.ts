/**
 * Writes to `securityLogs` — the only module that does.
 *
 * Three shapes of row: a `login` when a session starts, a `logout` when it ends carrying the
 * screens visited in between, and `action`/`scan` rows for individual writes at the front desk.
 * The collection is append-only by rule, so a session is two immutable documents rather than one
 * that gets updated on the way out. See the `securityLogs` block in firestore.rules for why.
 *
 * Every function here fails open — a logging problem must never surface as a broken app. The
 * rules file has to be deployed for these writes to be permitted at all, and an undeployed rules
 * file would otherwise turn every sign-out into an error. `console.warn` rather than
 * `console.error` for the same reason as lib/authLog.ts: console.error raises Expo's full-screen
 * LogBox over whatever the user was doing.
 */
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import type { User } from 'firebase/auth';

import { db } from '@/lib/firebase';
import type { Role, ScreenVisit, SecurityLogType, SessionEndReason } from '@/types/models';

/**
 * The collection is built here rather than imported from `col` in lib/firestore.ts on purpose:
 * the write helpers in that module call `logAction`, and importing back the other way would make
 * the two files a cycle. `col.securityLogs()` still exists there for the admin screen's read.
 */
const securityLogs = () => collection(db, 'securityLogs');

/**
 * Who the current session belongs to, kept here so `logAction` can be called from a write helper
 * deep in lib/firestore.ts without every call site threading an actor through.
 *
 * The role comes from AuthContext because only it resolves the custom claim; `auth.currentUser`
 * alone cannot answer it.
 */
let actor: { uid: string; who: string; role: Role | null } | null = null;

/** Screens visited this session, flushed into the logout row. */
let screenBuffer: ScreenVisit[] = [];

/**
 * A single document must stay well under Firestore's 1 MiB limit. A machine left signed in on the
 * front desk all day would otherwise accumulate an unbounded trail. Past the cap the oldest
 * entries drop, which is the right end to lose: the recent screens are what an admin is looking
 * for when they open a session row.
 */
const MAX_SCREENS = 200;

/**
 * Guards against a second login row for the same session. `onAuthStateChanged` fires again on a
 * token refresh, and a provider re-mount replays it from scratch — module scope rather than a ref
 * so neither produces a duplicate.
 */
let loggedInUid: string | null = null;

export function setLogActor(user: User | null, role: Role | null, displayName?: string | null) {
  if (!user) {
    actor = null;
    return;
  }
  actor = {
    uid: user.uid,
    who: displayName || user.displayName || user.email || user.uid,
    role,
  };
}

async function write(
  type: SecurityLogType,
  extra: Record<string, unknown> = {},
  who = actor
): Promise<void> {
  if (!who) return;
  try {
    await addDoc(securityLogs(), {
      type,
      uid: who.uid,
      who: who.who,
      role: who.role,
      at: serverTimestamp(),
      ...extra,
    });
  } catch (error) {
    console.warn(`[securityLog] could not write ${type} row`, error);
  }
}

export async function logLogin(
  user: User,
  role: Role | null,
  displayName?: string | null
): Promise<void> {
  setLogActor(user, role, displayName);
  if (loggedInUid === user.uid) return;
  loggedInUid = user.uid;
  screenBuffer = [];
  await write('login');
}

/**
 * Buffers a screen visit in memory. Nothing is written until the session ends.
 *
 * Batching is a quota decision: a member moving between four tabs generates dozens of navigations
 * an hour, and the Spark plan allows 20k Firestore writes a day across the whole app — check-ins,
 * payments and stats included. One row per session instead of one per tap keeps the log from
 * crowding out the features it is meant to observe.
 */
export function recordScreen(name: string): void {
  if (!actor) return;
  // usePathname re-fires on any re-render, not just navigation, so consecutive duplicates are
  // the common case rather than an edge one.
  if (screenBuffer[screenBuffer.length - 1]?.name === name) return;
  screenBuffer.push({ at: Date.now(), name });
  if (screenBuffer.length > MAX_SCREENS) screenBuffer = screenBuffer.slice(-MAX_SCREENS);
}

/**
 * Closes the session. Must be awaited *before* `signOut(auth)`: the create rule requires
 * `isSignedIn()`, so this write is denied the moment the credential is gone.
 *
 * The actor is captured before clearing, because the caller may already have torn down the
 * context state by the time this runs.
 */
export async function logLogout(reason: SessionEndReason): Promise<void> {
  const who = actor;
  const screens = screenBuffer;
  actor = null;
  screenBuffer = [];
  loggedInUid = null;
  if (!who) return;
  await write('logout', { reason, screens }, who);
}

/** A staff or admin write worth attributing. `action` is a stable key; `detail` is for humans. */
export async function logAction(action: string, detail?: string): Promise<void> {
  await write('action', detail === undefined ? { action } : { action, detail });
}

/**
 * A visitor admitted — the QR scanner (camera or uploaded image) and the desk's walk-in form both
 * land here, since what the log cares about is that someone was let in and by whom.
 */
export async function logScan(action: string, detail: string): Promise<void> {
  await write('scan', { action, detail });
}
