import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit as fbLimit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';

import { db } from '@/lib/firebase';
import { composeFullName, normalizeNameParts } from '@/lib/names';
import { logAction, logScan } from '@/lib/securityLog';
import type {
  Announcement,
  CheckIn,
  DailyStats,
  Member,
  MemberStatus,
  MonthlyStats,
  NonMember,
  Payment,
  Plan,
  PricingSettings,
  SecurityLog,
  UserDoc,
  UsernameDoc,
} from '@/types/models';

export const col = {
  users: () => collection(db, 'users'),
  usernames: () => collection(db, 'usernames'),
  members: () => collection(db, 'members'),
  nonMembers: () => collection(db, 'nonMembers'),
  plans: () => collection(db, 'plans'),
  payments: () => collection(db, 'payments'),
  checkins: () => collection(db, 'checkins'),
  securityLogs: () => collection(db, 'securityLogs'),
  announcements: () => collection(db, 'announcements'),
  dailyStats: () => collection(db, 'stats', 'daily', 'entries'),
  monthlyStats: () => collection(db, 'stats', 'monthly', 'entries'),
};

export const ref = {
  user: (uid: string) => doc(db, 'users', uid),
  /** Doc id *is* the lowercased username — that is what enforces uniqueness. */
  username: (username: string) => doc(db, 'usernames', username),
  member: (id: string) => doc(db, 'members', id),
  nonMember: (id: string) => doc(db, 'nonMembers', id),
  plan: (id: string) => doc(db, 'plans', id),
  /** The day-pass fee. Admin writes, any signed-in client reads. */
  pricing: () => doc(db, 'settings', 'pricing'),
  dailyStat: (id: string) => doc(db, 'stats', 'daily', 'entries', id),
  monthlyStat: (id: string) => doc(db, 'stats', 'monthly', 'entries', id),
};

/** Firestore doesn't return the doc id inside data(); every read goes through this. */
export function withId<T>(snap: QueryDocumentSnapshot): T {
  return { id: snap.id, ...snap.data() } as T;
}

// ---------------------------------------------------------------- queries

export const q = {
  memberByUid: (uid: string) => query(col.members(), where('uid', '==', uid), fbLimit(1)),

  /**
   * Deliberately unordered, and every other query below follows the same rule.
   *
   * Two Firestore behaviours bite here, both of them silent:
   *  - `orderBy(field)` excludes documents that lack the field entirely — not sorted last,
   *    *absent*. A member written before `fullName` was composed on create would vanish.
   *  - a `where` + `orderBy` on different fields needs a composite index, and until it is
   *    deployed the listener errors. useCollection turns that into an empty array, which is
   *    indistinguishable from "you have no members" on screen.
   *
   * A single gym's roster is a few hundred rows at most and the screens already filter in
   * memory, so ordering and limiting happen there (sortByDisplayName / slice) and the reads
   * need no index to work.
   */
  allMembers: () => query(col.members()),

  membersByStatus: (status: MemberStatus) =>
    query(col.members(), where('status', '==', status)),

  /** Every account, for the admin user-management screen. Requires the staff read rule. */
  allUsers: () => query(col.users()),

  activePlans: () => query(col.plans(), where('active', '==', true)),

  allPlans: () => query(col.plans()),

  paymentsForMember: (memberId: string) =>
    query(col.payments(), where('memberId', '==', memberId)),

  /**
   * Unlimited on the wire, trimmed by the caller. `orderBy('paidAt')` would hide a payment
   * whose serverTimestamp is still resolving — exactly the one just recorded at the front
   * desk, which is the one staff look for to confirm the sale registered.
   */
  recentPayments: () => query(col.payments()),

  checkinsForMember: (memberId: string) =>
    query(col.checkins(), where('memberId', '==', memberId)),

  /** Every visit by every kind of visitor, for the admin attendance log. Staff-only. */
  allCheckins: () => query(col.checkins()),

  /** Every walk-in on record, for the attendance screen's name lookups. Staff-only. */
  allNonMembers: () => query(col.nonMembers()),

  checkinsSince: (since: Date) => query(col.checkins(), where('at', '>=', since)),

  /**
   * The audit trail, bounded to a window. Admin-only by rule.
   *
   * A single-field inequality, which Firestore indexes automatically — no composite index and
   * therefore none of the "listener silently renders empty" failure described above. The bound
   * is also the only thing keeping this read finite: the collection grows with every session and
   * has no TTL (Firestore TTL is not on the Spark plan).
   */
  securityLogsSince: (since: Date) => query(col.securityLogs(), where('at', '>=', since)),

  activeAnnouncements: () => query(col.announcements(), where('active', '==', true)),

  /** Trailing window for the revenue chart; ids are YYYY-MM so lexical order is chronological. */
  monthlyStatsSince: (yyyymm: string) =>
    query(col.monthlyStats(), where('__name__', '>=', yyyymm), orderBy('__name__')),
};

// ---------------------------------------------------------------- writes

/**
 * Drops keys whose value is `undefined` before a write.
 *
 * Firestore rejects `undefined` outright — the whole document fails with `invalid-argument`,
 * naming only the first offending field. That matters here because the natural way to express
 * "the user left this blank" in TypeScript is `values.notes?.trim() || undefined`, and the
 * types below mark those fields optional, so a caller passing them is not a bug on its face.
 * Stripping at the write layer means every form can keep using `undefined` for "absent" and an
 * omitted key means the same thing in Firestore: the field simply isn't there.
 *
 * Deliberately shallow. A nested `undefined` (`emergencyContact: { phone: undefined }`) would
 * still be rejected, and silently rewriting nested shapes would hide a real modelling mistake.
 */
function stripUndefined<T extends Record<string, unknown>>(data: T): T {
  return Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)) as T;
}

/**
 * Records a write in the security log, without making the caller wait for it.
 *
 * Fire-and-forget on purpose. The audit row is secondary to the write it describes: a member
 * should not fail to save because the log could not be written, and the front desk should not
 * wait on a second round-trip to see the payment register. `logAction` swallows its own errors.
 *
 * Placed after the primary write in every caller, so a rejected write logs nothing rather than
 * claiming something happened that did not.
 */
function audit(action: string, detail?: string): void {
  void logAction(action, detail);
}

/**
 * Peso amounts for audit detail strings. Local rather than `formatCurrency` from lib/format.ts,
 * which reaches into the components layer for a Badge type — the data layer should not depend on
 * the UI to describe a number.
 */
function formatPesos(cents: number): string {
  return `₱${(cents / 100).toFixed(2)}`;
}

export type NewMemberInput = Pick<
  Member,
  'firstName' | 'lastName' | 'email' | 'phone' | 'planId' | 'planName'
> &
  Partial<Pick<Member, 'uid' | 'middleName' | 'emergencyContact' | 'notes'>> & {
    startDate: Date;
    endDate: Date;
  };

export async function createMember(input: NewMemberInput) {
  const name = normalizeNameParts(input);
  const fullName = composeFullName(name);
  const created = await addDoc(
    col.members(),
    stripUndefined({
      ...input,
      ...name,
      // Composed once on write so `orderBy('fullName')` and the search box keep working.
      fullName,
      uid: input.uid ?? null,
      status: 'active' satisfies MemberStatus,
      joinedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  );
  audit('member.create', fullName);
  return created;
}

/**
 * The unlogged primitive. Everything below that has a name for what it is doing writes its own
 * audit row through the wrapper, so archiving does not also show up as a bare "edited member".
 */
function patchMember(id: string, patch: Partial<Member>) {
  return updateDoc(ref.member(id), stripUndefined({ ...patch, updatedAt: serverTimestamp() }));
}

export async function updateMember(id: string, patch: Partial<Member>) {
  const result = await patchMember(id, patch);
  audit('member.update', patch.fullName ?? id);
  return result;
}

export async function setMemberStatus(id: string, status: MemberStatus) {
  const result = await patchMember(id, { status });
  audit('member.status', `${id} → ${status}`);
  return result;
}

/**
 * Retires a membership without destroying anything.
 *
 * "Delete" on the Accounts screen means this. A true delete is not available to the client and
 * would be the wrong shape anyway: the sign-in credential lives in Firebase Auth, `deleteUser`
 * is Admin SDK only, and removing the Firestore document alone would leave a working login
 * pointing at nothing. Archiving also keeps the payment and attendance history that the revenue
 * figures and the attendance log are derived from — a removed member would silently rewrite last
 * month's totals.
 *
 * `status: 'cancelled'` is what stops the membership counting as active anywhere; `archived`
 * only controls whether the row is listed. Both are set together so a cancelled-but-visible
 * member stays possible (the existing Cancel action) while an archived one is always cancelled.
 */
export async function archiveMember(id: string) {
  const result = await patchMember(id, { archived: true, status: 'cancelled' });
  audit('member.archive', id);
  return result;
}

/**
 * Puts an archived membership back in the list. The term is *not* reinstated — `status` stays
 * cancelled, so the desk renews it deliberately rather than a restore quietly granting access.
 */
export async function restoreMember(id: string) {
  const result = await patchMember(id, { archived: false });
  audit('member.restore', id);
  return result;
}

export async function upsertUserProfile(uid: string, patch: Partial<UserDoc>) {
  const result = await setDoc(ref.user(uid), stripUndefined(patch), { merge: true });
  audit('account.update', patch.displayName ?? patch.email ?? uid);
  return result;
}

export async function createCheckIn(memberId: string, memberName: string, recordedBy: string) {
  const created = await addDoc(col.checkins(), {
    kind: 'member' satisfies CheckIn['kind'],
    memberId,
    // Stamped explicitly rather than left absent: the attendance screen discriminates on `kind`,
    // and a missing key would make every member row read as a partially-written non-member.
    nonMemberId: null,
    memberName,
    recordedBy,
    at: serverTimestamp(),
  });
  // Logged here rather than in app/scan.tsx so the camera and the uploaded-image path are both
  // covered by construction — a member check-in can only reach this function through a QR.
  void logScan('checkin.member', memberName);
  return created;
}

export type NonMemberInput = Pick<NonMember, 'id' | 'firstName' | 'lastName'> &
  Partial<Pick<NonMember, 'middleName'>>;

/**
 * Creates or touches the `nonMembers/{id}` record for a walk-in, keyed by the id in their QR.
 *
 * Runs on the *staff* client, never the visitor's — an unauthenticated device cannot write to
 * Firestore, and this collection is staff-only by rule. Idempotent by design: the same pass
 * scanned on a later visit merges into the existing row and bumps the counter instead of
 * creating a second person.
 *
 * A transaction rather than `increment()` because `firstSeenAt` must survive the second visit:
 * plain merge would rewrite it to today's date every time, which is precisely the one fact this
 * document exists to remember.
 */
export async function upsertNonMember(input: NonMemberInput) {
  const name = normalizeNameParts(input);
  const docRef = ref.nonMember(input.id);

  await runTransaction(db, async (tx) => {
    const existing = await tx.get(docRef);
    const base = {
      ...name,
      fullName: composeFullName(name),
      lastVisitAt: serverTimestamp(),
    };

    if (existing.exists()) {
      tx.update(docRef, { ...base, visits: (existing.get('visits') ?? 0) + 1 });
      return;
    }

    tx.set(docRef, { ...base, visits: 1, firstSeenAt: serverTimestamp() });
  });
}

/** The attendance row for a walk-in. `memberId` stays null so member queries never match it. */
export async function createNonMemberCheckIn(
  nonMemberId: string,
  memberName: string,
  recordedBy: string
) {
  const created = await addDoc(col.checkins(), {
    kind: 'nonmember' satisfies CheckIn['kind'],
    memberId: null,
    nonMemberId,
    memberName,
    recordedBy,
    at: serverTimestamp(),
  });
  // Both the scanner and the desk's walk-in form arrive here. The log records that someone was
  // admitted and by whom, which is the same fact either way.
  void logScan('checkin.walkin', memberName);
  return created;
}

export type NewPaymentInput = Pick<
  Payment,
  | 'memberId'
  | 'memberName'
  | 'planId'
  | 'planName'
  | 'amountCents'
  | 'method'
  | 'kind'
  | 'recordedBy'
> & { periodStart: Date; periodEnd: Date };

/**
 * Writing a payment is what moves the sales dashboard — the aggregates trigger increments
 * the stats/daily and stats/monthly counters from this doc.
 */
export async function recordPayment(input: NewPaymentInput) {
  const created = await addDoc(
    col.payments(),
    stripUndefined({ ...input, paidAt: serverTimestamp() })
  );
  audit(
    'payment.record',
    `${input.memberName} · ${input.planName} · ${formatPesos(input.amountCents)}`
  );
  return created;
}

/**
 * The day-pass fee charged to a walk-in at the desk or straight after their QR is scanned.
 *
 * Written into `payments` like any other sale, with `memberId: null` and no plan, so the monthly
 * revenue figure is one sum over one collection rather than two sources that can disagree. The
 * period is the single day of the visit, which keeps the shape identical to a membership payment
 * for the CSV export and any future aggregation.
 *
 * Amount is a caller decision, not a lookup: `settings/pricing` supplies the default but the
 * form leaves it editable, because comped and discounted visits are ordinary at a front desk.
 */
export async function recordWalkInPayment(params: {
  nonMemberId: string;
  visitorName: string;
  amountCents: number;
  method: Payment['method'];
  recordedBy: string;
  at?: Date;
}) {
  const day = params.at ?? new Date();
  const created = await addDoc(
    col.payments(),
    stripUndefined({
      memberId: null,
      memberName: params.visitorName,
      // No plan was bought. Empty rather than absent so the CSV columns line up with membership
      // rows and every reader can treat the field as present.
      planId: '',
      planName: 'Walk-in day pass',
      amountCents: params.amountCents,
      method: params.method,
      kind: 'walkin' satisfies Payment['kind'],
      nonMemberId: params.nonMemberId,
      periodStart: day,
      periodEnd: day,
      recordedBy: params.recordedBy,
      paidAt: serverTimestamp(),
    })
  );
  audit('payment.walkin', `${params.visitorName} · ${formatPesos(params.amountCents)}`);
  return created;
}

/** Renewal = extend the member term and log the payment together. */
export async function renewMembership(params: {
  memberId: string;
  memberName: string;
  planId: string;
  planName: string;
  amountCents: number;
  method: Payment['method'];
  start: Date;
  end: Date;
  recordedBy: string;
}) {
  // patchMember, not updateMember: the renewal is one event, and logging it as an anonymous
  // "member edited" alongside the payment row would describe the same action twice.
  await patchMember(params.memberId, {
    planId: params.planId,
    planName: params.planName,
    endDate: params.end as unknown as Member['endDate'],
    status: 'active',
  });
  audit('membership.renew', `${params.memberName} · ${params.planName}`);
  return recordPayment({
    memberId: params.memberId,
    memberName: params.memberName,
    planId: params.planId,
    planName: params.planName,
    amountCents: params.amountCents,
    method: params.method,
    kind: 'renewal',
    periodStart: params.start,
    periodEnd: params.end,
    recordedBy: params.recordedBy,
  });
}

export async function savePlan(plan: Omit<Plan, 'id' | 'createdAt'> & { id?: string }) {
  const { id, ...data } = plan;
  if (id) {
    const result = await setDoc(ref.plan(id), stripUndefined(data), { merge: true });
    audit('plan.update', `${data.name} · ${formatPesos(data.priceCents)}`);
    return result;
  }
  const created = await addDoc(
    col.plans(),
    stripUndefined({ ...data, createdAt: serverTimestamp() })
  );
  audit('plan.create', `${data.name} · ${formatPesos(data.priceCents)}`);
  return created;
}

/** One-shot fetch used by the CSV export, which doesn't need a live listener. */
export async function fetchAllPayments(): Promise<Payment[]> {
  const snap = await getDocs(query(col.payments(), orderBy('paidAt', 'desc')));
  return snap.docs.map((d) => withId<Payment>(d));
}

/**
 * The default walk-in fee, in centavos. Falls back to 0 when unset — a gym that has not priced
 * day passes yet gets an empty amount field to fill in, not a number someone else picked.
 */
export const DEFAULT_WALK_IN_CENTS = 0;

export async function fetchPricing(): Promise<PricingSettings> {
  const snap = await getDoc(ref.pricing());
  const cents = snap.exists() ? snap.get('walkInCents') : null;
  return { walkInCents: typeof cents === 'number' ? cents : DEFAULT_WALK_IN_CENTS };
}

export async function saveWalkInPrice(walkInCents: number, updatedBy: string) {
  const result = await setDoc(
    ref.pricing(),
    { walkInCents, updatedBy, updatedAt: serverTimestamp() },
    { merge: true }
  );
  audit('pricing.walkin', formatPesos(walkInCents));
  return result;
}

export type {
  Announcement,
  CheckIn,
  DailyStats,
  Member,
  MonthlyStats,
  NonMember,
  Payment,
  Plan,
  PricingSettings,
  SecurityLog,
  UserDoc,
  UsernameDoc,
};
