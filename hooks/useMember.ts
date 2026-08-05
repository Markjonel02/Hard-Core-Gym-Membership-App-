import { useEffect, useMemo, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';

import { useAuth } from '@/context/AuthContext';
import { useCollection } from '@/hooks/useCollection';
import { db } from '@/lib/firebase';
import { partitionArchived } from '@/lib/archive';
import { q } from '@/lib/firestore';
import { daysUntil, sortByDateDesc, toDate } from '@/lib/format';
import type { CheckIn, Member, Payment, Plan } from '@/types/models';

/** Derived membership timeline for the member dashboard ring. */
export function useMembership() {
  const { member } = useAuth();

  return useMemo(() => {
    const days = daysUntil(member?.endDate);
    const start = toDate(member?.startDate);
    const end = toDate(member?.endDate);

    // Fraction of the paid term still remaining, for the progress ring.
    let progress = 0;
    if (start && end) {
      const total = end.getTime() - start.getTime();
      const left = end.getTime() - Date.now();
      progress = total > 0 ? Math.min(1, Math.max(0, left / total)) : 0;
    }

    return {
      member,
      daysRemaining: days,
      progress,
      isExpired: days !== null && days < 0,
      /** The 3-month window the Gmail reminder fires on. */
      isExpiringSoon: days !== null && days >= 0 && days <= 90,
    };
  }, [member]);
}

/**
 * Newest-first payment history. The query is unordered (see lib/firestore.ts) so the sort
 * lives here — which also means a payment whose serverTimestamp is still resolving shows up
 * immediately instead of being dropped by an orderBy on a field it does not have yet.
 */
export function useMyPayments() {
  const { member } = useAuth();
  const paymentsQuery = useMemo(
    () => (member ? q.paymentsForMember(member.id) : null),
    [member]
  );
  const { data, loading, error } = useCollection<Payment>(paymentsQuery);
  const sorted = useMemo(() => sortByDateDesc(data, 'paidAt'), [data]);
  return { data: sorted, loading, error };
}

export function useMyCheckins(n = 10) {
  const { member } = useAuth();
  const checkinsQuery = useMemo(
    () => (member ? q.checkinsForMember(member.id) : null),
    [member]
  );
  const { data, loading, error } = useCollection<CheckIn>(checkinsQuery);
  const sorted = useMemo(() => sortByDateDesc(data, 'at').slice(0, n), [data, n]);
  return { data: sorted, loading, error };
}

/** Cheapest plan first — the ordering the old `orderBy('priceCents')` provided. */
function byPrice(plans: Plan[]): Plan[] {
  return [...plans].sort((a, b) => (a.priceCents ?? 0) - (b.priceCents ?? 0));
}

export function useActivePlans() {
  const plansQuery = useMemo(() => q.activePlans(), []);
  const { data, loading, error } = useCollection<Plan>(plansQuery);
  const sorted = useMemo(() => byPrice(data), [data]);
  return { data: sorted, loading, error };
}

export function useAllPlans() {
  const plansQuery = useMemo(() => q.allPlans(), []);
  const { data, loading, error } = useCollection<Plan>(plansQuery);
  const sorted = useMemo(() => byPrice(data), [data]);
  return { data: sorted, loading, error };
}

/**
 * Every membership, archived ones included.
 *
 * Deliberately unfiltered, because the two current callers need opposite things: the Accounts
 * screen shows archived rows behind a filter chip, and `usePendingAccounts` must count an
 * archived membership as a link — otherwise archiving someone would resurrect them in the
 * "pending membership" list as though they had never been sold anything. Screens that want only
 * live rows use `partitionArchived` from `lib/archive.ts`.
 */
export function useAllMembers() {
  const membersQuery = useMemo(() => q.allMembers(), []);
  return useCollection<Member>(membersQuery);
}

/** Live memberships only — the default roster view. */
export function useActiveRoster() {
  const { data, loading, error } = useAllMembers();
  const split = useMemo(() => partitionArchived(data), [data]);
  return { data: split.active, archived: split.archived, loading, error };
}

/** Single member for the admin detail screen. */
export function useMemberById(id: string | undefined) {
  const [member, setMember] = useState<Member | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!id) {
      setMember(null);
      setLoading(false);
      return;
    }
    return onSnapshot(
      doc(db, 'members', id),
      (snap) => {
        setMember(snap.exists() ? ({ id: snap.id, ...snap.data() } as Member) : null);
        setError(null);
        setLoading(false);
      },
      (err) => {
        console.error('[firestore] member listener failed', err);
        setError(err);
        setLoading(false);
      }
    );
  }, [id]);

  const paymentsQuery = useMemo(() => (id ? q.paymentsForMember(id) : null), [id]);
  const { data: rawPayments } = useCollection<Payment>(paymentsQuery);
  const payments = useMemo(() => sortByDateDesc(rawPayments, 'paidAt'), [rawPayments]);

  const checkinsQuery = useMemo(() => (id ? q.checkinsForMember(id) : null), [id]);
  const { data: rawCheckins } = useCollection<CheckIn>(checkinsQuery);
  const checkins = useMemo(
    () => sortByDateDesc(rawCheckins, 'at').slice(0, 20),
    [rawCheckins]
  );

  return { member, payments, checkins, loading, error };
}
