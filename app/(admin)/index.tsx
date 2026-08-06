import { useMemo } from 'react';
import { Platform, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import { BarChart, LineChart } from 'react-native-gifted-charts';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Pager } from '@/components/ui/Pager';
import { Screen } from '@/components/ui/Screen';
import { StatTile } from '@/components/ui/StatTile';
import { SkeletonList } from '@/components/ui/Skeleton';
import { useThemeColor } from '@/components/Themed';
import { FontSize, FontWeight, Spacing } from '@/constants/Theme';
import { useCollection } from '@/hooks/useCollection';
import { usePagination, PAGE_SIZE } from '@/hooks/usePagination';
import {
  useActiveMembers,
  useExpiringMembers,
  useMonthlyStats,
  useRevenueByMonth,
  useTodayCheckins,
} from '@/hooks/useStats';
import { usePendingAccounts } from '@/hooks/useUsers';
import { exportPaymentsCsv } from '@/lib/csv';
import { q } from '@/lib/firestore';
import {
  daysUntil,
  formatCompactCurrency,
  formatCurrency,
  formatDate,
  membershipTone,
  sortByDateDesc,
} from '@/lib/format';
import { memberDisplayName } from '@/lib/names';
import type { Payment } from '@/types/models';

export default function AdminSales() {
  const { series: revenueByMonth, thisMonth, lastMonth, loading, error: revenueError } = useRevenueByMonth(12);
  const { series: checkinStats, loading: statsLoading, error: statsError } = useMonthlyStats(12);
  const { data: activeMembers, error: membersError } = useActiveMembers();
  const { data: expiring } = useExpiringMembers(90);
  const { data: todayCheckins } = useTodayCheckins();
  const { data: pending } = usePendingAccounts();

  const recentQuery = useMemo(() => q.recentPayments(), []);
  const { data: allPayments } = useCollection<Payment>(recentQuery);
  // Sorted here because the query has no orderBy, so a payment recorded seconds ago — whose
  // serverTimestamp has not resolved — still appears instead of being filtered out. No longer
  // capped at 8: the list is paged, and a cap would have hidden everything past the first page.
  const recentPayments = useMemo(() => sortByDateDesc(allPayments, 'paidAt'), [allPayments]);

  const payments = usePagination(recentPayments);
  const atRisk = usePagination(expiring);

  const text = useThemeColor({}, 'text');
  const muted = useThemeColor({}, 'muted');
  const brand = useThemeColor({}, 'brand');
  const success = useThemeColor({}, 'success');
  const warning = useThemeColor({}, 'warning');
  const danger = useThemeColor({}, 'danger');
  const border = useThemeColor({}, 'border');

  const { width } = useWindowDimensions();
  const chartWidth = Math.min(width, 900) - Spacing.lg * 4;

  const revenueData = useMemo(
    () => revenueByMonth.map((row) => ({ value: row.revenueCents / 100, label: row.label })),
    [revenueByMonth]
  );

  // Grouped new-vs-renewal bars: two adjacent bars per month, spacing separates the pairs.
  const acquisitionData = useMemo(
    () =>
      checkinStats.flatMap((row) => [
        { value: row.newMembers, label: row.label, frontColor: brand, spacing: 2 },
        { value: row.renewals, frontColor: success },
      ]),
    [checkinStats, brand, success]
  );

  const momDelta = useMemo(() => {
    if (!lastMonth || !thisMonth) return undefined;
    const prev = lastMonth.revenueCents;
    if (prev === 0) return thisMonth.revenueCents > 0 ? 'First revenue month' : undefined;
    const pct = Math.round(((thisMonth.revenueCents - prev) / prev) * 100);
    return `${pct >= 0 ? '▲' : '▼'} ${Math.abs(pct)}% vs last month`;
  }, [thisMonth, lastMonth]);

  const maxRevenue = Math.max(...revenueData.map((d) => d.value), 1);

  return (
    <Screen title="Sales" subtitle="Revenue, growth, and retention at a glance">
      {/*
        A failed listener leaves every number at zero, which reads as a quiet gym rather than
        a broken read. Saying so up front is the difference between "no sales yet" and
        "this dashboard is not seeing the database".
      */}
      {membersError || statsError || revenueError ? (
        <Card style={{ gap: Spacing.xs, borderColor: danger, borderWidth: 1 }}>
          <Text style={{ color: danger, fontWeight: FontWeight.semibold }}>
            Some figures below could not load
          </Text>
          <Text style={{ color: muted, fontSize: FontSize.sm }}>
            {(membersError ?? statsError ?? revenueError)?.message}
          </Text>
          <Text style={{ color: muted, fontSize: FontSize.sm }}>
            Tiles showing 0 may be a permissions or connection problem, not an empty database.
          </Text>
        </Card>
      ) : null}

      <View style={styles.tiles}>
        <StatTile
          label="Revenue this month"
          value={formatCompactCurrency(thisMonth?.revenueCents ?? 0)}
          delta={momDelta}
          tone="brand"
        />
        <StatTile label="Active members" value={String(activeMembers.length)} tone="success" />
        <StatTile
          label="Expiring ≤ 90 days"
          value={String(expiring.length)}
          delta="Auto-emailed at 90/30/7"
          tone="warning"
        />
        <StatTile label="Check-ins today" value={String(todayCheckins.length)} />
      </View>

      {/*
        Accounts that signed up and verified but hold no membership record. Without this card
        they are invisible: they are not in `members`, so no roster, tile, or chart can show
        them, and the person is left staring at "no membership linked" while the gym has no
        idea they are waiting. This is the hand-off, not a diagnostic.
      */}
      {pending.length > 0 ? (
        <Card style={{ gap: Spacing.md, borderColor: warning, borderWidth: 1 }}>
          <View style={styles.legendRow}>
            <Text style={[styles.sectionTitle, { color: text }]}>Waiting for a membership</Text>
            <Badge label={`${pending.length}`} tone="warning" />
          </View>
          <Text style={{ color: muted, fontSize: FontSize.sm }}>
            These people created an account but have no plan yet. Add them as a member to link
            the account, start their term, and give them a check-in QR code.
          </Text>
          <View>
            {pending.slice(0, 6).map((account, index) => (
              <View
                key={account.uid}
                style={[
                  styles.listRow,
                  index > 0 && {
                    borderTopWidth: StyleSheet.hairlineWidth,
                    borderTopColor: border,
                  },
                ]}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={[styles.rowTitle, { color: text }]} numberOfLines={1}>
                    {account.name}
                  </Text>
                  <Text style={{ color: muted, fontSize: FontSize.sm }} numberOfLines={1}>
                    {account.email}
                  </Text>
                </View>
                <Button
                  title="Add"
                  variant="secondary"
                  fullWidth={false}
                  onPress={() =>
                    router.push({
                      pathname: '/(admin)/members/new',
                      // Prefills the form and, critically, carries the uid so the new member doc
                      // links to this login instead of creating an unattached duplicate.
                      params: {
                        uid: account.uid,
                        email: account.email ?? '',
                        firstName: account.firstName ?? '',
                        middleName: account.middleName ?? '',
                        lastName: account.lastName ?? '',
                        phone: account.phone ?? '',
                      },
                    })
                  }
                />
              </View>
            ))}
          </View>
          {pending.length > 6 ? (
            <Button
              title={`View all ${pending.length} accounts`}
              variant="ghost"
              onPress={() => router.push('/(admin)/users')}
            />
          ) : null}
        </Card>
      ) : null}

      <Card style={{ gap: Spacing.md }}>
        <Text style={[styles.sectionTitle, { color: text }]}>Revenue — last 12 months</Text>
        {loading ? (
          <SkeletonList rows={1} height={200} />
        ) : (
          <LineChart
            data={revenueData}
            width={chartWidth}
            height={200}
            initialSpacing={12}
            spacing={Math.max(24, chartWidth / 14)}
            color={brand}
            thickness={3}
            startFillColor={brand}
            endFillColor={brand}
            startOpacity={0.25}
            endOpacity={0.02}
            areaChart
            curved
            dataPointsColor={brand}
            dataPointsRadius={4}
            yAxisColor="transparent"
            xAxisColor={border}
            yAxisTextStyle={{ color: muted, fontSize: 10 }}
            xAxisLabelTextStyle={{ color: muted, fontSize: 10 }}
            noOfSections={4}
            maxValue={Math.ceil(maxRevenue * 1.2)}
            yAxisLabelPrefix="₱"
            rulesColor={border}
          />
        )}
      </Card>

      <Card style={{ gap: Spacing.md }}>
        <View style={styles.legendRow}>
          <Text style={[styles.sectionTitle, { color: text }]}>New vs renewals</Text>
          <View style={styles.legend}>
            <LegendDot color={brand} label="New" muted={muted} />
            <LegendDot color={success} label="Renewal" muted={muted} />
          </View>
        </View>
        {loading ? (
          <SkeletonList rows={1} height={180} />
        ) : (
          <BarChart
            data={acquisitionData}
            width={chartWidth}
            height={180}
            barWidth={Math.max(6, chartWidth / 40)}
            spacing={Math.max(10, chartWidth / 30)}
            initialSpacing={12}
            roundedTop
            yAxisColor="transparent"
            xAxisColor={border}
            yAxisTextStyle={{ color: muted, fontSize: 10 }}
            xAxisLabelTextStyle={{ color: muted, fontSize: 10 }}
            noOfSections={3}
            rulesColor={border}
          />
        )}
      </Card>

      <Card style={{ gap: Spacing.md }}>
        <View style={styles.legendRow}>
          <Text style={[styles.sectionTitle, { color: text }]}>At risk — expiring soon</Text>
          <Badge label={`${expiring.length}`} tone="warning" />
        </View>
        {expiring.length === 0 ? (
          <EmptyState title="Nobody expiring in the next 90 days" />
        ) : (
          <View>
            {atRisk.pageRows.map((member, index) => {
              const days = daysUntil(member.endDate);
              return (
                <View
                  key={member.id}
                  style={[
                    styles.listRow,
                    index > 0 && {
                      borderTopWidth: StyleSheet.hairlineWidth,
                      borderTopColor: border,
                    },
                  ]}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={[styles.rowTitle, { color: text }]}>
                      {memberDisplayName(member)}
                    </Text>
                    <Text style={{ color: muted, fontSize: FontSize.sm }}>
                      {member.planName ?? 'No plan'} · expires {formatDate(member.endDate)}
                    </Text>
                  </View>
                  <Badge
                    label={days !== null && days < 0 ? 'overdue' : `${days}d`}
                    tone={membershipTone(member.status, days)}
                  />
                </View>
              );
            })}
            <Pager pagination={atRisk} label="members" />
            {expiring.length > PAGE_SIZE ? (
              <Button
                title={`View all ${expiring.length} members`}
                variant="ghost"
                onPress={() => router.push('/(admin)/members')}
                style={{ marginTop: Spacing.md }}
              />
            ) : null}
          </View>
        )}
      </Card>

      <Card style={{ gap: Spacing.md }}>
        <Text style={[styles.sectionTitle, { color: text }]}>Recent payments</Text>
        {recentPayments.length === 0 ? (
          <EmptyState title="No payments yet" message="Record a payment from a member's profile." />
        ) : (
          <View>
            {payments.pageRows.map((payment, index) => (
              <View
                key={payment.id}
                style={[
                  styles.listRow,
                  index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: border },
                ]}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={[styles.rowTitle, { color: text }]}>{payment.memberName}</Text>
                  <Text style={{ color: muted, fontSize: FontSize.sm }}>
                    {payment.planName} · {formatDate(payment.paidAt)}
                  </Text>
                </View>
                <Text style={[styles.amount, { color: text }]}>
                  {formatCurrency(payment.amountCents)}
                </Text>
              </View>
            ))}
            <Pager pagination={payments} label="payments" />
          </View>
        )}
      </Card>

      {/* Browser download only; native export would need expo-file-system + expo-sharing. */}
      {Platform.OS === 'web' ? (
        <Button title="Export payments to CSV" variant="secondary" onPress={exportPaymentsCsv} />
      ) : null}
    </Screen>
  );
}

function LegendDot({ color, label, muted }: { color: string; label: string; muted: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={{ color: muted, fontSize: FontSize.xs }}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md },
  sectionTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  legend: { flexDirection: 'row', gap: Spacing.md },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  dot: { width: 10, height: 10, borderRadius: 5 },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.md,
  },
  rowTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold },
  amount: { fontSize: FontSize.md, fontWeight: FontWeight.bold },
});
