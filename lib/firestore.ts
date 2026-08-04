import {
  addDoc,
  collection,
  doc,
  getDocs,
  limit as fbLimit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';

import { db } from '@/lib/firebase';
import { composeFullName, normalizeNameParts } from '@/lib/names';
import type {
  Announcement,
  CheckIn,
  DailyStats,
  Member,
  MemberStatus,
  MonthlyStats,
  Payment,
  Plan,
  UserDoc,
  UsernameDoc,
} from '@/types/models';

export const col = {
  users: () => collection(db, 'users'),
  usernames: () => collection(db, 'usernames'),
  members: () => collection(db, 'members'),
  plans: () => collection(db, 'plans'),
  payments: () => collection(db, 'payments'),
  checkins: () => collection(db, 'checkins'),
  announcements: () => collection(db, 'announcements'),
  dailyStats: () => collection(db, 'stats', 'daily', 'entries'),
  monthlyStats: () => collection(db, 'stats', 'monthly', 'entries'),
};

export const ref = {
  user: (uid: string) => doc(db, 'users', uid),
  /** Doc id *is* the lowercased username — that is what enforces uniqueness. */
  username: (username: string) => doc(db, 'usernames', username),
  member: (id: string) => doc(db, 'members', id),
  plan: (id: string) => doc(db, 'plans', id),
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

  checkinsSince: (since: Date) => query(col.checkins(), where('at', '>=', since)),

  activeAnnouncements: () => query(col.announcements(), where('active', '==', true)),

  /** Trailing window for the revenue chart; ids are YYYY-MM so lexical order is chronological. */
  monthlyStatsSince: (yyyymm: string) =>
    query(col.monthlyStats(), where('__name__', '>=', yyyymm), orderBy('__name__')),
};

// ---------------------------------------------------------------- writes

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
  return addDoc(col.members(), {
    ...input,
    ...name,
    // Composed once on write so `orderBy('fullName')` and the search box keep working.
    fullName: composeFullName(name),
    uid: input.uid ?? null,
    status: 'active' satisfies MemberStatus,
    joinedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function updateMember(id: string, patch: Partial<Member>) {
  return updateDoc(ref.member(id), { ...patch, updatedAt: serverTimestamp() });
}

export async function setMemberStatus(id: string, status: MemberStatus) {
  return updateMember(id, { status });
}

export async function upsertUserProfile(uid: string, patch: Partial<UserDoc>) {
  return setDoc(ref.user(uid), patch, { merge: true });
}

export async function createCheckIn(memberId: string, memberName: string, recordedBy: string) {
  return addDoc(col.checkins(), {
    memberId,
    memberName,
    recordedBy,
    at: serverTimestamp(),
  });
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
  return addDoc(col.payments(), { ...input, paidAt: serverTimestamp() });
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
  await updateMember(params.memberId, {
    planId: params.planId,
    planName: params.planName,
    endDate: params.end as unknown as Member['endDate'],
    status: 'active',
  });
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
  if (id) return setDoc(ref.plan(id), data, { merge: true });
  return addDoc(col.plans(), { ...data, createdAt: serverTimestamp() });
}

/** One-shot fetch used by the CSV export, which doesn't need a live listener. */
export async function fetchAllPayments(): Promise<Payment[]> {
  const snap = await getDocs(query(col.payments(), orderBy('paidAt', 'desc')));
  return snap.docs.map((d) => withId<Payment>(d));
}

export type { Announcement, CheckIn, DailyStats, Member, MonthlyStats, Payment, Plan, UserDoc, UsernameDoc };
