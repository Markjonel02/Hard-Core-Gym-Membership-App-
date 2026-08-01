import { StyleSheet, Text, View } from 'react-native';

import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Screen } from '@/components/ui/Screen';
import { SkeletonList } from '@/components/ui/Skeleton';
import { useThemeColor } from '@/components/Themed';
import { FontSize, FontWeight, Spacing } from '@/constants/Theme';
import { useActivePlans, useMembership, useMyPayments } from '@/hooks/useMember';
import { formatCurrency, formatDate, membershipTone } from '@/lib/format';

export default function Membership() {
  const { member, daysRemaining, isExpired } = useMembership();
  const { data: payments, loading } = useMyPayments();
  const { data: plans } = useActivePlans();

  const text = useThemeColor({}, 'text');
  const muted = useThemeColor({}, 'muted');
  const brand = useThemeColor({}, 'brand');
  const border = useThemeColor({}, 'border');

  if (!member) {
    return (
      <Screen title="Membership">
        <Card>
          <EmptyState
            title="No membership linked"
            message="Ask the front desk to link your account, then your plan and payment history appear here."
          />
        </Card>
      </Screen>
    );
  }

  return (
    <Screen title="Membership">
      <Card style={{ gap: Spacing.md }}>
        <View style={styles.planHeader}>
          <View style={{ gap: Spacing.xs }}>
            <Text style={[styles.planName, { color: text }]}>{member.planName}</Text>
            <Text style={{ color: muted }}>
              {formatDate(member.startDate)} — {formatDate(member.endDate)}
            </Text>
          </View>
          <Badge
            label={isExpired ? 'Expired' : member.status}
            tone={membershipTone(member.status, daysRemaining)}
          />
        </View>
        {!isExpired && daysRemaining !== null ? (
          <Text style={{ color: muted }}>{daysRemaining} days remaining on this term.</Text>
        ) : null}
      </Card>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: text }]}>Payment history</Text>
        {loading ? (
          <SkeletonList rows={3} height={64} />
        ) : payments.length === 0 ? (
          <Card>
            <EmptyState
              title="No payments recorded"
              message="Payments added by the front desk show up here as receipts."
            />
          </Card>
        ) : (
          <Card padded={false}>
            {payments.map((payment, index) => (
              <View
                key={payment.id}
                style={[
                  styles.row,
                  index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: border },
                ]}>
                <View style={styles.rowMain}>
                  <Text style={[styles.rowTitle, { color: text }]}>{payment.planName}</Text>
                  <Text style={{ color: muted, fontSize: FontSize.sm }}>
                    {formatDate(payment.paidAt)} · {payment.method.toUpperCase()} ·{' '}
                    {payment.kind === 'new' ? 'New' : 'Renewal'}
                  </Text>
                </View>
                <Text style={[styles.amount, { color: text }]}>
                  {formatCurrency(payment.amountCents)}
                </Text>
              </View>
            ))}
          </Card>
        )}
      </View>

      {plans.length ? (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: text }]}>Available plans</Text>
          <Text style={{ color: muted }}>Renew or upgrade at the front desk.</Text>
          {plans.map((plan) => (
            <Card key={plan.id} style={{ gap: Spacing.sm }}>
              <View style={styles.planHeader}>
                <Text style={[styles.rowTitle, { color: text }]}>{plan.name}</Text>
                <Text style={[styles.amount, { color: brand }]}>
                  {formatCurrency(plan.priceCents)}
                </Text>
              </View>
              <Text style={{ color: muted, fontSize: FontSize.sm }}>
                {plan.durationMonths} month{plan.durationMonths === 1 ? '' : 's'}
              </Text>
              {plan.perks?.length ? (
                <View style={{ gap: 2 }}>
                  {plan.perks.map((perk) => (
                    <Text key={perk} style={{ color: muted, fontSize: FontSize.sm }}>
                      • {perk}
                    </Text>
                  ))}
                </View>
              ) : null}
            </Card>
          ))}
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  planHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: Spacing.md,
  },
  planName: { fontSize: FontSize.xl, fontWeight: FontWeight.bold },
  section: { gap: Spacing.md },
  sectionTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    gap: Spacing.md,
  },
  rowMain: { flex: 1, gap: 2 },
  rowTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold },
  amount: { fontSize: FontSize.md, fontWeight: FontWeight.bold },
});
