import { useState } from 'react';
import { Alert, Platform, StyleSheet, Switch, Text, View } from 'react-native';
import { router } from 'expo-router';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Screen } from '@/components/ui/Screen';
import { useThemeColor } from '@/components/Themed';
import { useAuth } from '@/context/AuthContext';
import { FontSize, FontWeight, Spacing } from '@/constants/Theme';
import { upsertUserProfile } from '@/lib/firestore';
import { formatDate, initialsOf } from '@/lib/format';

export default function Profile() {
  const { user, profile, role, member, signOut } = useAuth();
  const text = useThemeColor({}, 'text');
  const muted = useThemeColor({}, 'muted');
  const brand = useThemeColor({}, 'brand');
  const brandMuted = useThemeColor({}, 'brandMuted');
  const border = useThemeColor({}, 'border');
  const [signingOut, setSigningOut] = useState(false);

  const displayName = profile?.displayName ?? user?.displayName ?? 'Member';
  const emailOptIn = profile?.emailOptIn ?? true;

  const toggleEmailOptIn = async (next: boolean) => {
    if (!user) return;
    await upsertUserProfile(user.uid, { emailOptIn: next });
  };

  const doSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
      router.replace('/(auth)/sign-in');
    } finally {
      setSigningOut(false);
    }
  };

  // Alert.alert has no effect on web, so confirm via window.confirm there.
  const confirmSignOut = () => {
    if (Platform.OS === 'web') {
      if (window.confirm('Sign out of Hardcore Gym?')) void doSignOut();
      return;
    }
    Alert.alert('Sign out', 'Sign out of Hardcore Gym?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => void doSignOut() },
    ]);
  };

  return (
    <Screen title="Profile">
      <Card style={styles.identity}>
        <View style={[styles.avatar, { backgroundColor: brandMuted }]}>
          <Text style={[styles.initials, { color: brand }]}>{initialsOf(displayName)}</Text>
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[styles.name, { color: text }]}>{displayName}</Text>
          <Text style={{ color: muted }}>{user?.email}</Text>
          {role ? (
            <Text style={{ color: muted, fontSize: FontSize.sm }}>
              Role: {role}
            </Text>
          ) : null}
        </View>
      </Card>

      {member ? (
        <Card style={{ gap: Spacing.md }}>
          <Text style={[styles.sectionTitle, { color: text }]}>Membership details</Text>
          <Row label="Plan" value={member.planName} border={border} muted={muted} text={text} />
          <Row label="Phone" value={member.phone || '—'} border={border} muted={muted} text={text} />
          <Row
            label="Started"
            value={formatDate(member.startDate)}
            border={border}
            muted={muted}
            text={text}
          />
          <Row
            label="Expires"
            value={formatDate(member.endDate)}
            border={border}
            muted={muted}
            text={text}
          />
          {member.emergencyContact?.name ? (
            <Row
              label="Emergency contact"
              value={`${member.emergencyContact.name} · ${member.emergencyContact.phone}`}
              border={border}
              muted={muted}
              text={text}
            />
          ) : null}
        </Card>
      ) : null}

      <Card style={{ gap: Spacing.md }}>
        <Text style={[styles.sectionTitle, { color: text }]}>Notifications</Text>
        <View style={styles.switchRow}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ color: text, fontWeight: FontWeight.medium }}>Expiry reminders</Text>
            <Text style={{ color: muted, fontSize: FontSize.sm }}>
              Email me 90, 30, and 7 days before my membership ends.
            </Text>
          </View>
          <Switch
            value={emailOptIn}
            onValueChange={(next) => void toggleEmailOptIn(next)}
            trackColor={{ true: brand }}
          />
        </View>
      </Card>

      <Button
        title="Sign out"
        variant="danger"
        loading={signingOut}
        onPress={confirmSignOut}
      />
    </Screen>
  );
}

function Row({
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
      <Text style={{ color: text, fontWeight: FontWeight.medium, flexShrink: 1, textAlign: 'right' }}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  identity: { flexDirection: 'row', alignItems: 'center', gap: Spacing.lg },
  avatar: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  initials: { fontSize: FontSize.xl, fontWeight: FontWeight.bold },
  name: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold },
  sectionTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Spacing.md,
    paddingTop: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
});
