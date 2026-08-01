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
} from '@/types/models';

export const col = {
  users: () => collection(db, 'users'),
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

  allMembers: () => query(col.members(), orderBy('fullName')),

  membersByStatus: (status: MemberStatus) =>
    query(col.members(), where('status', '==', status), orderBy('fullName')),

  /** At-risk list for the admin dashboard. Needs the (status, endDate) composite index. */
  expiringBefore: (cutoff: Date) =>
    query(
      col.members(),
      where('status', '==', 'active'),
      where('endDate', '<=', cutoff),
      orderBy('endDate')
    ),

  activePlans: () => query(col.plans(), where('active', '==', true), orderBy('priceCents')),

  allPlans: () => query(col.plans(), orderBy('priceCents')),

  paymentsForMember: (memberId: string) =>
    query(col.payments(), where('memberId', '==', memberId), orderBy('paidAt', 'desc')),

  recentPayments: (n = 20) => query(col.payments(), orderBy('paidAt', 'desc'), fbLimit(n)),

  checkinsForMember: (memberId: string, n = 10) =>
    query(col.checkins(), where('memberId', '==', memberId), orderBy('at', 'desc'), fbLimit(n)),

  checkinsSince: (since: Date) =>
    query(col.checkins(), where('at', '>=', since), orderBy('at', 'desc')),

  activeAnnouncements: () =>
    query(
      col.announcements(),
      where('active', '==', true),
      orderBy('createdAt', 'desc'),
      fbLimit(5)
    ),

  /** Trailing window for the revenue chart; ids are YYYY-MM so lexical order is chronological. */
  monthlyStatsSince: (yyyymm: string) =>
    query(col.monthlyStats(), where('__name__', '>=', yyyymm), orderBy('__name__')),
};

// ---------------------------------------------------------------- writes

export type NewMemberInput = Pick<
  Member,
  'fullName' | 'email' | 'phone' | 'planId' | 'planName'
> &
  Partial<Pick<Member, 'uid' | 'emergencyContact' | 'notes'>> & {
    startDate: Date;
    endDate: Date;
  };

export async function createMember(input: NewMemberInput) {
  return addDoc(col.members(), {
    ...input,
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

export type { Announcement, CheckIn, DailyStats, Member, MonthlyStats, Payment, Plan, UserDoc };
