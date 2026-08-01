import { useEffect, useMemo, useState } from 'react';
import { format, startOfToday, subMonths } from 'date-fns';
import { onSnapshot } from 'firebase/firestore';

import { useCollection } from '@/hooks/useCollection';
import { q, ref } from '@/lib/firestore';
import type { CheckIn, Member, MonthlyStats } from '@/types/models';

const MONTH_ID = 'yyyy-MM';

/**
 * Reads the pre-aggregated stats/monthly counters maintained by the aggregates trigger.
 * Firestore has no GROUP BY, so summing payments client-side would mean downloading every
 * payment doc; the counters keep this dashboard at a handful of reads.
 */
export function useMonthlyStats(months = 12) {
  const since = useMemo(() => format(subMonths(new Date(), months - 1), MONTH_ID), [months]);
  const statsQuery = useMemo(() => q.monthlyStatsSince(since), [since]);
  const { data, loading, error } = useCollection<MonthlyStats>(statsQuery);

  const series = useMemo(() => {
    const byId = new Map(data.map((row) => [row.id, row]));
    // Fill gaps so a month with no sales renders as zero rather than collapsing the axis.
    return Array.from({ length: months }, (_, i) => {
      const date = subMonths(new Date(), months - 1 - i);
      const id = format(date, MONTH_ID);
      const row = byId.get(id);
      return {
        id,
        label: format(date, 'MMM'),
        revenueCents: row?.revenueCents ?? 0,
        newMembers: row?.newMembers ?? 0,
        renewals: row?.renewals ?? 0,
        checkins: row?.checkins ?? 0,
      };
    });
  }, [data, months]);

  const thisMonth = series[series.length - 1];
  const lastMonth = series[series.length - 2];

  return { series, thisMonth, lastMonth, loading, error };
}

/** Live document listener for a single monthly counter doc. */
export function useCurrentMonthRevenue() {
  const [revenueCents, setRevenueCents] = useState(0);

  useEffect(() => {
    const id = format(new Date(), MONTH_ID);
    return onSnapshot(ref.monthlyStat(id), (snap) => {
      setRevenueCents(snap.exists() ? ((snap.data().revenueCents as number) ?? 0) : 0);
    });
  }, []);

  return revenueCents;
}

export function useTodayCheckins() {
  const todayQuery = useMemo(() => q.checkinsSince(startOfToday()), []);
  return useCollection<CheckIn>(todayQuery);
}

export function useActiveMembers() {
  const activeQuery = useMemo(() => q.membersByStatus('active'), []);
  return useCollection<Member>(activeQuery);
}

/** Members whose membership lapses inside `days` — the at-risk list and the 90-day tile. */
export function useExpiringMembers(days = 90) {
  const cutoff = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d;
  }, [days]);
  const expiringQuery = useMemo(() => q.expiringBefore(cutoff), [cutoff]);
  return useCollection<Member>(expiringQuery);
}
