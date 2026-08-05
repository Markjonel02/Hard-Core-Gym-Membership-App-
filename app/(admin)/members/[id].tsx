import { useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { httpsCallable } from 'firebase/functions';
import QRCode from 'react-native-qrcode-svg';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Screen } from '@/components/ui/Screen';
import { SkeletonList } from '@/components/ui/Skeleton';
import { useThemeColor } from '@/components/Themed';
import { useAuth } from '@/context/AuthContext';
import { FontSize, FontWeight, Radius, Spacing } from '@/constants/Theme';
import { useActivePlans, useMemberById } from '@/hooks/useMember';
import { authErrorMessage } from '@/lib/authErrors';
import { functions } from '@/lib/firebase';
import { createCheckIn, renewMembership, setMemberStatus } from '@/lib/firestore';
import {
  daysUntil,
  formatCurrency,
  formatDate,
  formatDateTime,
  initialsOf,
  membershipTone,
} from '@/lib/format';
import { nextTermFor } from '@/lib/membership';
import { buildMemberPass } from '@/lib/nonMembers';

export default function MemberDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { member, payments, checkins, loading } = useMemberById(id);
  const { data: plans } = useActivePlans();
  const { user } = useAuth();

  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renewPlanId, setRenewPlanId] = useState<string | null>(null);

  const text = useThemeColor({}, 'text');
  const muted = useThemeColor({}, 'muted');
  const brand = useThemeColor({}, 'brand');
  const brandMuted = useThemeColor({}, 'brandMuted');
  const surface = useThemeColor({}, 'surface');
  const border = useThemeColor({}, 'border');
  const success = useThemeColor({}, 'success');
  const danger = useThemeColor({}, 'danger');

  if (loading) {
    return (
      <Screen>
        <SkeletonList rows={4} height={90} />
      </Screen>
    );
  }

  if (!member) {
    return (
      <Screen>
        <Card>
          <EmptyState
            title="Member not found"
            message="This member may have been removed."
            actionLabel="Back to members"
            onAction={() => router.replace('/(admin)/members')}
          />
        </Card>
      </Screen>
    );
  }

  const days = daysUntil(member.endDate);
  const selectedPlan = plans.find((p) => p.id === renewPlanId) ?? null;
  const term = selectedPlan ? nextTermFor(member, selectedPlan) : null;

  const confirm = (title: string, body: string, onConfirm: () => void) => {
    if (Platform.OS === 'web') {
      if (window.confirm(`${title}\n\n${body}`)) onConfirm();
      return;
    }
    Alert.alert(title, body, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Confirm', onPress: onConfirm },
    ]);
  };

  const run = async (key: string, fn: () => Promise<void>, ok: string) => {
    setBusy(key);
    setError(null);
    setMessage(null);
    try {
      await fn();
      setMessage(ok);
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const doRenew = () => {
    if (!selectedPlan || !term) {
      setError('Choose a plan to renew into.');
      return;
    }
    void run(
      'renew',
      () =>
        renewMembership({
          memberId: member.id,
          memberName: member.fullName,
          planId: selectedPlan.id,
          planName: selectedPlan.name,
          amountCents: selectedPlan.priceCents,
          method: 'cash',
          start: term.start,
          end: term.end,
          recordedBy: user?.uid ?? 'unknown',
        }).then(() => setRenewPlanId(null)),
      `Renewed until ${formatDate(term.end)}.`
    );
  };

  // Lets staff re-send the expiry email out of band instead of waiting for the daily job.
  const sendReminder = () =>
    void run(
      'remind',
      async () => {
        const call = httpsCallable(functions, 'sendExpiryReminder');
        await call({ memberId: member.id });
      },
      `Reminder emailed to ${member.email}.`
    );

  return (
    <Screen>
      <Card style={styles.identity}>
        <View style={[styles.avatar, { backgroundColor: brandMuted }]}>
          <Text style={[styles.initials, { color: brand }]}>{initialsOf(member.fullName)}</Text>
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={[styles.name, { color: text }]}>{member.fullName}</Text>
          <Text style={{ color: muted }}>{member.email}</Text>
          <Text style={{ color: muted }}>{member.phone}</Text>
        </View>
        <Badge
          label={
            member.status === 'active' && days !== null && days <= 90 ? `${days}d` : member.status
          }
          tone={membershipTone(member.status, days)}
        />
      </Card>

      {message ? <Text style={{ color: success }}>{message}</Text> : null}
      {error ? <Text style={{ color: danger }}>{error}</Text> : null}

      {/*
        The member's own pass, rendered here so the desk can scan or print it for someone who
        has not installed the app or cannot get to their phone. It is the same code the member
        sees — `member.id` never changes — so a printed copy stays valid for the life of the
        membership and there is nothing to reissue on renewal.
      */}
      <Card style={styles.qrCard}>
        <Text style={[styles.sectionTitle, { color: text }]}>Check-in QR</Text>
        <View style={[styles.qrFrame, { borderColor: border }]}>
          <QRCode value={buildMemberPass(member.id)} size={180} backgroundColor="#ffffff" color="#000000" />
        </View>
        <Text style={{ color: muted, fontSize: FontSize.sm, textAlign: 'center' }}>
          Permanent code for {member.fullName}. Safe to print or screenshot.
        </Text>
      </Card>

      <Card style={{ gap: Spacing.md }}>
        <Text style={[styles.sectionTitle, { color: text }]}>Membership</Text>
        <Detail label="Plan" value={member.planName} border={border} muted={muted} text={text} />
        <Detail
          label="Term"
          value={`${formatDate(member.startDate)} — ${formatDate(member.endDate)}`}
          border={border}
          muted={muted}
          text={text}
        />
        <Detail
          label="Days remaining"
          value={days === null ? '—' : days < 0 ? `${Math.abs(days)} overdue` : String(days)}
          border={border}
          muted={muted}
          text={text}
        />
        <Detail
          label="Joined"
          value={formatDate(member.joinedAt)}
          border={border}
          muted={muted}
          text={text}
        />
        {member.emergencyContact?.name ? (
          <Detail
            label="Emergency"
            value={`${member.emergencyContact.name} · ${member.emergencyContact.phone}`}
            border={border}
            muted={muted}
            text={text}
          />
        ) : null}
        {member.notes ? (
          <Detail label="Notes" value={member.notes} border={border} muted={muted} text={text} />
        ) : null}
      </Card>

      <Card style={{ gap: Spacing.md }}>
        <Text style={[styles.sectionTitle, { color: text }]}>Renew membership</Text>
        {plans.map((plan) => {
          const selected = plan.id === renewPlanId;
          return (
            <Pressable
              key={plan.id}
              onPress={() => setRenewPlanId(selected ? null : plan.id)}
              style={[
                styles.planOption,
                {
                  backgroundColor: selected ? brandMuted : surface,
                  borderColor: selected ? brand : border,
                },
              ]}>
              <Text style={{ color: text, flex: 1, fontWeight: FontWeight.medium }}>
                {plan.name}
              </Text>
              <Text style={{ color: selected ? brand : text, fontWeight: FontWeight.bold }}>
                {formatCurrency(plan.priceCents)}
              </Text>
            </Pressable>
          );
        })}
        {term ? (
          <Text style={{ color: muted, fontSize: FontSize.sm }}>
            New term: {formatDate(term.start)} — {formatDate(term.end)}
            {days !== null && days > 0 ? ' (remaining days carried over)' : ''}
          </Text>
        ) : null}
        <Button
          title="Record renewal payment"
          loading={busy === 'renew'}
          disabled={!selectedPlan}
          onPress={doRenew}
        />
      </Card>

      <Card style={{ gap: Spacing.md }}>
        <Text style={[styles.sectionTitle, { color: text }]}>Actions</Text>
        <Button
          title="Check in now"
          variant="secondary"
          loading={busy === 'checkin'}
          onPress={() =>
            void run(
              'checkin',
              () =>
                createCheckIn(member.id, member.fullName, user?.uid ?? 'unknown').then(() => undefined),
              'Checked in.'
            )
          }
        />
        <Button
          title="Send expiry reminder now"
          variant="secondary"
          loading={busy === 'remind'}
          onPress={sendReminder}
        />
        {member.status === 'frozen' ? (
          <Button
            title="Unfreeze membership"
            variant="secondary"
            loading={busy === 'status'}
            onPress={() =>
              void run(
                'status',
                () => setMemberStatus(member.id, 'active').then(() => undefined),
                'Membership reactivated.'
              )
            }
          />
        ) : (
          <Button
            title="Freeze membership"
            variant="secondary"
            loading={busy === 'status'}
            onPress={() =>
              confirm('Freeze membership', `Pause access for ${member.fullName}?`, () =>
                void run(
                  'status',
                  () => setMemberStatus(member.id, 'frozen').then(() => undefined),
                  'Membership frozen.'
                )
              )
            }
          />
        )}
        <Button
          title="Cancel membership"
          variant="danger"
          loading={busy === 'cancel'}
          onPress={() =>
            confirm(
              'Cancel membership',
              `This ends ${member.fullName}'s access. Payment history is kept.`,
              () =>
                void run(
                  'cancel',
                  () => setMemberStatus(member.id, 'cancelled').then(() => undefined),
                  'Membership cancelled.'
                )
            )
          }
        />
      </Card>

      <Card style={{ gap: Spacing.md }}>
        <Text style={[styles.sectionTitle, { color: text }]}>Payments</Text>
        {payments.length === 0 ? (
          <EmptyState title="No payments recorded" />
        ) : (
          payments.map((payment, index) => (
            <View
              key={payment.id}
              style={[
                styles.listRow,
                index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: border },
              ]}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ color: text, fontWeight: FontWeight.medium }}>
                  {payment.planName}
                </Text>
                <Text style={{ color: muted, fontSize: FontSize.sm }}>
                  {formatDate(payment.paidAt)} · {payment.method.toUpperCase()} ·{' '}
                  {payment.kind === 'new' ? 'New' : 'Renewal'}
                </Text>
              </View>
              <Text style={{ color: text, fontWeight: FontWeight.bold }}>
                {formatCurrency(payment.amountCents)}
              </Text>
            </View>
          ))
        )}
      </Card>

      <Card style={{ gap: Spacing.md }}>
        <Text style={[styles.sectionTitle, { color: text }]}>Recent check-ins</Text>
        {checkins.length === 0 ? (
          <EmptyState title="No check-ins yet" />
        ) : (
          checkins.map((entry, index) => (
            <View
              key={entry.id}
              style={[
                styles.listRow,
                index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: border },
              ]}>
              <Text style={{ color: text }}>{formatDateTime(entry.at)}</Text>
            </View>
          ))
        )}
      </Card>
    </Screen>
  );
}

function Detail({
  label,
  value,
  border,
  muted,
  text,
}: {
  label: string;
  value: string;
  border: string;
  muted: string;
  text: string;
}) {
  return (
    <View style={[styles.detailRow, { borderTopColor: border }]}>
      <Text style={{ color: muted }}>{label}</Text>
      <Text
        style={{
          color: text,
          fontWeight: FontWeight.medium,
          flexShrink: 1,
          textAlign: 'right',
        }}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  identity: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  avatar: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  initials: { fontSize: FontSize.lg, fontWeight: FontWeight.bold },
  name: { fontSize: FontSize.lg, fontWeight: FontWeight.bold },
  sectionTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold },
  qrCard: { alignItems: 'center', gap: Spacing.md },
  // White plate behind the code so it stays scannable in dark mode, matching the member's own
  // check-in screen — a QR rendered on a dark surface is not reliably readable.
  qrFrame: {
    padding: Spacing.lg,
    backgroundColor: '#ffffff',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Spacing.md,
    paddingTop: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  planOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingTop: Spacing.md,
  },
});
