import { useEffect, useMemo, useState } from 'react';
import { format, startOfToday, subMonths } from 'date-fns';
import { onSnapshot } from 'firebase/firestore';

import { useCollection } from '@/hooks/useCollection';
import { q, ref } from '@/lib/firestore';
import { daysUntil, sortByDateAsc } from '@/lib/format';
import type { CheckIn, Member, MonthlyStats } from '@/types/models';

const MONTH_ID = 'yyyy-MM';

/**
 * Reads the pre-aggregated stats/monthly counters maintained by the aggregates trigger.
 * Firestore has no GROUP BY, so summing payments client-side would mean downloading every
 * payment doc; the counters keep this dashboard at a handful of reads.
 *
 * These counters only exist if the aggregates Cloud Function is deployed and has fired. An
 * undeployed backend therefore shows a flat zero chart with healthy-looking member tiles —
 * which is why the dashboard renders `error` separately instead of treating empty as fine.
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

  /** No counter docs at all is the signature of a backend that never ran. */
  const hasAnyStats = data.length > 0;

  return { series, thisMonth, lastMonth, loading, error, hasAnyStats };
}

/** Live document listener for a single monthly counter doc. */
export function useCurrentMonthRevenue() {
  const [revenueCents, setRevenueCents] = useState(0);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const id = format(new Date(), MONTH_ID);
    return onSnapshot(
      ref.monthlyStat(id),
      (snap) => {
        setRevenueCents(snap.exists() ? ((snap.data().revenueCents as number) ?? 0) : 0);
        setError(null);
      },
      // Without this handler a rules rejection leaves the tile reading ₱0 forever, which is
      // a plausible number — the failure is invisible precisely because zero looks like data.
      (err) => {
        console.error('[firestore] monthly revenue listener failed', err);
        setError(err);
      }
    );
  }, []);

  return { revenueCents, error };
}

export function useTodayCheckins() {
  const todayQuery = useMemo(() => q.checkinsSince(startOfToday()), []);
  return useCollection<CheckIn>(todayQuery);
}

export function useActiveMembers() {
  const activeQuery = useMemo(() => q.membersByStatus('active'), []);
  return useCollection<Member>(activeQuery);
}

/**
 * Members whose membership lapses inside `days` — the at-risk list and the 90-day tile.
 *
 * Filtered in memory off the active-members listener rather than with a range query. The
 * `status == 'active' && endDate <= cutoff` version needs a composite index, and until that
 * index is deployed the listener fails and the tile silently reads 0 — the same number a
 * healthy gym with nobody expiring would show.
 */
export function useExpiringMembers(days = 90) {
  const { data: active, loading, error } = useActiveMembers();

  const data = useMemo(() => {
    const soon = active.filter((member) => {
      const left = daysUntil(member.endDate);
      return left !== null && left <= days;
    });
    return sortByDateAsc(soon, 'endDate');
  }, [active, days]);

  return { data, loading, error };
}
