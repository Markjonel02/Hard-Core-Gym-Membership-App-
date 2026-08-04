import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { ProgressRing } from '@/components/ui/ProgressRing';
import { Screen } from '@/components/ui/Screen';
import { SkeletonList } from '@/components/ui/Skeleton';
import { useThemeColor } from '@/components/Themed';
import { useAuth } from '@/context/AuthContext';
import { FontSize, FontWeight, Spacing } from '@/constants/Theme';
import { useCollection } from '@/hooks/useCollection';
import { useMembership, useMyCheckins } from '@/hooks/useMember';
import { q } from '@/lib/firestore';
import { formatDate, formatDateTime, membershipTone, sortByDateDesc } from '@/lib/format';
import { greetingName } from '@/lib/names';
import type { Announcement } from '@/types/models';

export default function MemberHome() {
  const { profile, user, loading } = useAuth();
  const { member, daysRemaining, progress, isExpired, isExpiringSoon } = useMembership();
  const { data: checkins, loading: checkinsLoading } = useMyCheckins(5);

  const announcementsQuery = useMemo(() => q.activeAnnouncements(), []);
  const { data: allAnnouncements } = useCollection<Announcement>(announcementsQuery);
  // Newest first, capped — the query dropped its orderBy/limit so nothing depends on an index.
  const announcements = useMemo(
    () => sortByDateDesc(allAnnouncements, 'createdAt').slice(0, 5),
    [allAnnouncements]
  );

  const text = useThemeColor({}, 'text');
  const muted = useThemeColor({}, 'muted');
  const brand = useThemeColor({}, 'brand');
  const success = useThemeColor({}, 'success');
  const warning = useThemeColor({}, 'warning');
  const danger = useThemeColor({}, 'danger');

  // Prefers the stored first name over splitting displayName, which guesses badly on
  // multi-word surnames like "Dela Cruz".
  const firstName = greetingName([profile?.firstName, profile?.displayName, user?.displayName]);

  if (loading) {
    return (
      <Screen title="Loading…">
        <SkeletonList rows={3} height={120} />
      </Screen>
    );
  }

  if (!member) {
    return (
      <Screen title={`Hi, ${firstName}`}>
        <Card>
          <EmptyState
            title="No membership linked yet"
            message="Your account isn't attached to a membership. Visit the front desk and they'll link it to this email — everything here fills in automatically once they do."
          />
        </Card>
      </Screen>
    );
  }

  const ringColor = isExpired ? danger : isExpiringSoon ? warning : success;
  const ringValue = isExpired ? '0' : String(daysRemaining ?? 0);

  return (
    <Screen title={`Hi, ${firstName}`} subtitle={member.planName}>
      <Card style={styles.hero}>
        <ProgressRing
          progress={progress}
          value={ringValue}
          caption={isExpired ? 'expired' : 'days left'}
          color={ringColor}
        />
        <View style={styles.heroMeta}>
          <Badge
            label={isExpired ? 'Expired' : member.status}
            tone={membershipTone(member.status, daysRemaining)}
          />
          <Text style={[styles.expiry, { color: text }]}>
            {isExpired ? 'Expired on ' : 'Renews on '}
            {formatDate(member.endDate)}
          </Text>
          <Text style={[styles.since, { color: muted }]}>
            Member since {formatDate(member.joinedAt)}
          </Text>
        </View>
      </Card>

      {isExpiringSoon || isExpired ? (
        <Card style={{ gap: Spacing.md }}>
          <Text style={[styles.noticeTitle, { color: isExpired ? danger : warning }]}>
            {isExpired ? 'Your membership has expired' : 'Renewal coming up'}
          </Text>
          <Text style={{ color: muted }}>
            {isExpired
              ? 'Renew at the front desk to regain access to the gym floor and classes.'
              : `Your plan ends in ${daysRemaining} days. We'll email you reminders at 90, 30, and 7 days out.`}
          </Text>
          <Button
            title="View renewal options"
            variant="secondary"
            onPress={() => router.push('/(member)/membership')}
          />
        </Card>
      ) : null}

      {announcements.length ? (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: text }]}>Announcements</Text>
          {announcements.map((item) => (
            <Card key={item.id} style={{ gap: Spacing.xs }}>
              <Text style={[styles.itemTitle, { color: brand }]}>{item.title}</Text>
              <Text style={{ color: muted }}>{item.body}</Text>
            </Card>
          ))}
        </View>
      ) : null}

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: text }]}>Recent check-ins</Text>
        {checkinsLoading ? (
          <SkeletonList rows={3} height={56} />
        ) : checkins.length === 0 ? (
          <Card>
            <EmptyState
              title="No check-ins yet"
              message="Show your QR code at the front desk to check in."
              actionLabel="Open my QR"
              onAction={() => router.push('/(member)/checkin')}
            />
          </Card>
        ) : (
          <Card padded={false}>
            {checkins.map((entry, index) => (
              <View
                key={entry.id}
                style={[styles.row, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: muted + '22' }]}>
                <Text style={{ color: text }}>{formatDateTime(entry.at)}</Text>
              </View>
            ))}
          </Card>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {
    alignItems: 'center',
    gap: Spacing.lg,
  },
  heroMeta: {
    alignItems: 'center',
    gap: Spacing.xs,
  },
  expiry: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold },
  since: { fontSize: FontSize.sm },
  section: { gap: Spacing.md },
  sectionTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold },
  itemTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold },
  noticeTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold },
  row: { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md },
});
