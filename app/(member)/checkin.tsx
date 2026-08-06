import { StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Pager } from '@/components/ui/Pager';
import { Screen } from '@/components/ui/Screen';
import { useThemeColor } from '@/components/Themed';
import { FontSize, FontWeight, Spacing } from '@/constants/Theme';
import { useMembership, useMyCheckins } from '@/hooks/useMember';
import { usePagination } from '@/hooks/usePagination';
import { formatDateTime, membershipTone } from '@/lib/format';
import { buildMemberPass } from '@/lib/nonMembers';

export default function CheckIn() {
  const { member, daysRemaining, isExpired } = useMembership();
  // 50, not 5: the list is paged five at a time now, so the old cap would have left the pager
  // with exactly one page and hidden the rest of the history it exists to reach.
  const { data: checkins } = useMyCheckins(50);
  const visits = usePagination(checkins);

  const text = useThemeColor({}, 'text');
  const muted = useThemeColor({}, 'muted');
  const border = useThemeColor({}, 'border');
  const danger = useThemeColor({}, 'danger');

  if (!member) {
    return (
      <Screen title="Check-in">
        <Card>
          <EmptyState
            title="No membership linked"
            message="Once the front desk links your membership, your check-in QR appears here."
          />
        </Card>
      </Screen>
    );
  }

  // Namespaced payload so the scanner can reject arbitrary QR codes. Built through the shared
  // helper because the scanner parses member and walk-in passes with one function — the envelope
  // has to be defined in exactly one place or the two drift.
  //
  // This code is permanent: it encodes `member.id`, which never changes for the life of the
  // membership. Renewing, freezing, or letting it lapse does not reissue it, so a member can
  // screenshot it once and a printed copy at the desk stays valid.
  const payload = buildMemberPass(member.id);

  return (
    <Screen title="Check-in" subtitle="Show this at the front desk">
      <Card style={styles.qrCard}>
        {/*
          The expiry warning sits *above* the code rather than replacing it. Hiding the QR was
          hiding the member's own identifier: the scanner already refuses an expired membership
          (app/scan.tsx), so the only thing a blank card achieved was stopping the front desk
          from pulling the record up to renew it — the one thing the member came in to do.
        */}
        {isExpired ? (
          <View style={styles.expiredBlock}>
            <Text style={[styles.expiredTitle, { color: danger }]}>Membership expired</Text>
            <Text style={{ color: muted, textAlign: 'center' }}>
              Show this code at the front desk to renew.
            </Text>
          </View>
        ) : null}

        <View style={[styles.qrFrame, { borderColor: border }]}>
          <QRCode value={payload} size={220} backgroundColor="#ffffff" color="#000000" />
        </View>
        <Text style={[styles.name, { color: text }]}>{member.fullName}</Text>
        <Badge label={member.status} tone={membershipTone(member.status, daysRemaining)} />
        <Text style={{ color: muted, fontSize: FontSize.sm, textAlign: 'center' }}>
          {member.planName}
        </Text>
      </Card>

      {checkins.length ? (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: text }]}>Recent visits</Text>
          <Card padded={false}>
            {visits.pageRows.map((entry, index) => (
              <View
                key={entry.id}
                style={[
                  styles.row,
                  index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: border },
                ]}>
                <Text style={{ color: text }}>{formatDateTime(entry.at)}</Text>
              </View>
            ))}
          </Card>
          <Pager pagination={visits} label="visits" style={styles.pager} />
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  qrCard: { alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.xl },
  // White plate behind the QR so it stays scannable in dark mode.
  qrFrame: {
    padding: Spacing.lg,
    backgroundColor: '#ffffff',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  name: { fontSize: FontSize.xl, fontWeight: FontWeight.bold },
  expiredBlock: { alignItems: 'center', gap: Spacing.sm },
  expiredTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold },
  section: { gap: Spacing.md },
  sectionTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold },
  row: { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md },
  // The card supplies the divider above the pager, so it needs no border of its own here.
  pager: { borderTopWidth: 0, paddingTop: 0 },
});
