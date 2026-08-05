import { useEffect, useMemo, useState } from 'react';
import { format, startOfToday, subMonths } from 'date-fns';
import { onSnapshot } from 'firebase/firestore';

import { useCollection } from '@/hooks/useCollection';
import { q, ref } from '@/lib/firestore';
import { daysUntil, sortByDateAsc, toDate } from '@/lib/format';
import type { CheckIn, Member, MonthlyStats, Payment } from '@/types/models';

const MONTH_ID = 'yyyy-MM';

/**
 * Same timezone and same formatting call the aggregates trigger uses, so a payment lands in the
 * same month bucket whether the number came from the counters or from this client-side sum.
 * A payment at 9pm Manila on the 31st belongs to that month, not to the UTC-next one.
 */
const TZ = 'Asia/Manila';

function monthIdOf(date: Date): string {
  return date.toLocaleDateString('en-CA', { timeZone: TZ }).slice(0, 7);
}

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

/**
 * Client-side revenue aggregation from the payments collection.
 *
 * The counters trigger cannot deploy on Spark, so the revenue chart would stay flat and the tile
 * would read ₱0 forever. This downloads every payment instead and buckets them in memory — slower,
 * but the collection is small enough that it costs less than explaining why the dashboard is broken.
 *
 * Bucketing uses the same timezone and format the trigger does, so a payment lands in the same
 * month whether it came from this sum or from a counter that was written before the project
 * downgraded. A payment at 9pm Manila on the 31st belongs to that month, not the UTC-next one.
 */
export function useRevenueByMonth(months = 12) {
  const paymentsQuery = useMemo(() => q.recentPayments(), []);
  const { data: payments, loading, error } = useCollection<Payment>(paymentsQuery);

  const series = useMemo(() => {
    // Bucket payments by Manila month
    const byMonth = new Map<string, number>();
    for (const payment of payments) {
      const date = toDate(payment.paidAt);
      if (!date) continue;
      const monthId = monthIdOf(date);
      byMonth.set(monthId, (byMonth.get(monthId) ?? 0) + (payment.amountCents ?? 0));
    }

    // Fill gaps so a month with no sales renders as zero rather than collapsing the axis
    return Array.from({ length: months }, (_, i) => {
      const date = subMonths(new Date(), months - 1 - i);
      const id = format(date, MONTH_ID);
      return {
        id,
        label: format(date, 'MMM'),
        revenueCents: byMonth.get(id) ?? 0,
      };
    });
  }, [payments, months]);

  const thisMonth = series[series.length - 1];
  const lastMonth = series[series.length - 2];

  return { series, thisMonth, lastMonth, loading, error };
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
