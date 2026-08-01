import { useMemo } from 'react';
import { Platform, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import { BarChart, LineChart } from 'react-native-gifted-charts';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Screen } from '@/components/ui/Screen';
import { StatTile } from '@/components/ui/StatTile';
import { SkeletonList } from '@/components/ui/Skeleton';
import { useThemeColor } from '@/components/Themed';
import { FontSize, FontWeight, Spacing } from '@/constants/Theme';
import { useCollection } from '@/hooks/useCollection';
import {
  useActiveMembers,
  useCurrentMonthRevenue,
  useExpiringMembers,
  useMonthlyStats,
  useTodayCheckins,
} from '@/hooks/useStats';
import { exportPaymentsCsv } from '@/lib/csv';
import { q } from '@/lib/firestore';
import {
  daysUntil,
  formatCompactCurrency,
  formatCurrency,
  formatDate,
  membershipTone,
} from '@/lib/format';
import type { Payment } from '@/types/models';

export default function AdminSales() {
  const { series, thisMonth, lastMonth, loading } = useMonthlyStats(12);
  const revenueThisMonth = useCurrentMonthRevenue();
  const { data: activeMembers } = useActiveMembers();
  const { data: expiring } = useExpiringMembers(90);
  const { data: todayCheckins } = useTodayCheckins();

  const recentQuery = useMemo(() => q.recentPayments(8), []);
  const { data: recentPayments } = useCollection<Payment>(recentQuery);

  const text = useThemeColor({}, 'text');
  const muted = useThemeColor({}, 'muted');
  const brand = useThemeColor({}, 'brand');
  const success = useThemeColor({}, 'success');
  const border = useThemeColor({}, 'border');

  const { width } = useWindowDimensions();
  const chartWidth = Math.min(width, 900) - Spacing.lg * 4;

  const revenueData = useMemo(
    () => series.map((row) => ({ value: row.revenueCents / 100, label: row.label })),
    [series]
  );

  // Grouped new-vs-renewal bars: two adjacent bars per month, spacing separates the pairs.
  const acquisitionData = useMemo(
    () =>
      series.flatMap((row) => [
        { value: row.newMembers, label: row.label, frontColor: brand, spacing: 2 },
        { value: row.renewals, frontColor: success },
      ]),
    [series, brand, success]
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
      <View style={styles.tiles}>
        <StatTile
          label="Revenue this month"
          value={formatCompactCurrency(revenueThisMonth)}
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
            {expiring.slice(0, 6).map((member, index) => {
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
                    <Text style={[styles.rowTitle, { color: text }]}>{member.fullName}</Text>
                    <Text style={{ color: muted, fontSize: FontSize.sm }}>
                      {member.planName} · expires {formatDate(member.endDate)}
                    </Text>
                  </View>
                  <Badge
                    label={days !== null && days < 0 ? 'overdue' : `${days}d`}
                    tone={membershipTone(member.status, days)}
                  />
                </View>
              );
            })}
            {expiring.length > 6 ? (
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
            {recentPayments.map((payment, index) => (
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
