import { useEffect, useMemo, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';

import { useAuth } from '@/context/AuthContext';
import { useCollection } from '@/hooks/useCollection';
import { db } from '@/lib/firebase';
import { q } from '@/lib/firestore';
import { daysUntil, toDate } from '@/lib/format';
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

export function useMyPayments() {
  const { member } = useAuth();
  const paymentsQuery = useMemo(
    () => (member ? q.paymentsForMember(member.id) : null),
    [member]
  );
  return useCollection<Payment>(paymentsQuery);
}

export function useMyCheckins(n = 10) {
  const { member } = useAuth();
  const checkinsQuery = useMemo(
    () => (member ? q.checkinsForMember(member.id, n) : null),
    [member, n]
  );
  return useCollection<CheckIn>(checkinsQuery);
}

export function useActivePlans() {
  const plansQuery = useMemo(() => q.activePlans(), []);
  return useCollection<Plan>(plansQuery);
}

export function useAllPlans() {
  const plansQuery = useMemo(() => q.allPlans(), []);
  return useCollection<Plan>(plansQuery);
}

export function useAllMembers() {
  const membersQuery = useMemo(() => q.allMembers(), []);
  return useCollection<Member>(membersQuery);
}

/** Single member for the admin detail screen. */
export function useMemberById(id: string | undefined) {
  const [member, setMember] = useState<Member | null>(null);
  const [loading, setLoading] = useState(true);

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
        setLoading(false);
      },
      () => setLoading(false)
    );
  }, [id]);

  const paymentsQuery = useMemo(() => (id ? q.paymentsForMember(id) : null), [id]);
  const { data: payments } = useCollection<Payment>(paymentsQuery);

  const checkinsQuery = useMemo(() => (id ? q.checkinsForMember(id, 20) : null), [id]);
  const { data: checkins } = useCollection<CheckIn>(checkinsQuery);

  return { member, payments, checkins, loading };
}
