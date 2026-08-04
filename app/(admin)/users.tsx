import { useMemo, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { httpsCallable } from 'firebase/functions';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Screen } from '@/components/ui/Screen';
import { SkeletonList } from '@/components/ui/Skeleton';
import { useThemeColor } from '@/components/Themed';
import { useAuth } from '@/context/AuthContext';
import { FontSize, FontWeight, Radius, Spacing } from '@/constants/Theme';
import { useAllMembers } from '@/hooks/useMember';
import { useAllUsers } from '@/hooks/useUsers';
import { authErrorMessage } from '@/lib/authErrors';
import { functions } from '@/lib/firebase';
import { formatDate, initialsOf } from '@/lib/format';
import { memberDisplayName } from '@/lib/names';
import type { Role, UserDoc } from '@/types/models';

type Filter = 'all' | 'pending' | 'members' | 'team';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'No membership' },
  { key: 'members', label: 'Members' },
  { key: 'team', label: 'Staff & admins' },
];

const ROLE_TONES: Record<Role, 'brand' | 'success' | 'neutral'> = {
  admin: 'brand',
  staff: 'success',
  member: 'neutral',
};

/**
 * Account management, distinct from the members roster on purpose.
 *
 * `users` and `members` answer different questions: who can sign in, versus who has paid for
 * a membership. Conflating them is what let a verified signup sit invisible — present in Auth,
 * absent from every screen the gym looks at. This screen is the view over the former, with the
 * membership link shown per row so the gap is visible rather than implied.
 */
export default function AdminUsers() {
  const { user: currentUser, role: myRole } = useAuth();
  const { data: users, loading, error } = useAllUsers();
  const { data: members } = useAllMembers();

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  /** Which button is spinning: the uid being changed and the role it is being changed to. */
  const [busy, setBusy] = useState<{ uid: string; role: Role } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const text = useThemeColor({}, 'text');
  const muted = useThemeColor({}, 'muted');
  const brand = useThemeColor({}, 'brand');
  const brandMuted = useThemeColor({}, 'brandMuted');
  const surface = useThemeColor({}, 'surface');
  const border = useThemeColor({}, 'border');
  const success = useThemeColor({}, 'success');
  const danger = useThemeColor({}, 'danger');

  /** uid -> membership, so each row can show whether the account is linked to a member doc. */
  const membershipByUid = useMemo(() => {
    const map = new Map<string, (typeof members)[number]>();
    for (const member of members) {
      if (member.uid) map.set(member.uid, member);
    }
    return map;
  }, [members]);

  const membershipByEmail = useMemo(() => {
    const map = new Map<string, (typeof members)[number]>();
    for (const member of members) {
      const email = member.email?.trim().toLowerCase();
      if (email) map.set(email, member);
    }
    return map;
  }, [members]);

  const linkedMembership = (account: UserDoc) => {
    if (account.uid && membershipByUid.has(account.uid)) {
      return membershipByUid.get(account.uid) ?? null;
    }
    const email = account.email?.trim().toLowerCase();
    return email ? membershipByEmail.get(email) ?? null : null;
  };

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return users.filter((account) => {
      if (needle) {
        const haystack = [account.email, account.username, memberDisplayName(account)]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      const role = account.role ?? 'member';
      const membership = linkedMembership(account);
      if (filter === 'team') return role === 'staff' || role === 'admin';
      if (filter === 'members') return Boolean(membership);
      if (filter === 'pending') return role === 'member' && !membership;
      return true;
    });
    // linkedMembership closes over the two maps, which are the real dependencies.
  }, [users, search, filter, membershipByUid, membershipByEmail]);

  const changeRole = async (account: UserDoc, nextRole: Role) => {
    setActionError(null);
    setMessage(null);
    setBusy({ uid: account.uid, role: nextRole });
    try {
      const call = httpsCallable(functions, 'setRole');
      await call({ uid: account.uid, role: nextRole });
      setMessage(
        `${memberDisplayName(account)} is now ${nextRole}. The change applies the next time they sign in.`
      );
    } catch (err) {
      setActionError(authErrorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const confirmRoleChange = (account: UserDoc, nextRole: Role) => {
    const name = memberDisplayName(account);
    const prompt =
      nextRole === 'member'
        ? `Remove ${name}'s staff access? They will lose the admin dashboard.`
        : `Give ${name} ${nextRole} access to the admin dashboard?`;

    if (Platform.OS === 'web') {
      if (window.confirm(prompt)) void changeRole(account, nextRole);
      return;
    }
    Alert.alert('Change role', prompt, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Confirm',
        style: nextRole === 'member' ? 'destructive' : 'default',
        onPress: () => void changeRole(account, nextRole),
      },
    ]);
  };

  return (
    <Screen scroll={false}>
      <View style={styles.controls}>
        <Input
          placeholder="Search name, email, or username"
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}>
          {FILTERS.map((item) => {
            const selected = filter === item.key;
            return (
              <Pressable
                key={item.key}
                onPress={() => setFilter(item.key)}
                style={[
                  styles.chip,
                  {
                    backgroundColor: selected ? brandMuted : surface,
                    borderColor: selected ? brand : border,
                  },
                ]}>
                <Text style={[styles.chipLabel, { color: selected ? brand : muted }]}>
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
        {message ? <Text style={{ color: success }}>{message}</Text> : null}
        {actionError ? <Text style={{ color: danger }}>{actionError}</Text> : null}
      </View>

      <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
        {loading ? (
          <SkeletonList rows={5} height={96} />
        ) : error ? (
          <Card>
            <EmptyState
              title="Could not load accounts"
              message={`${error.message}\n\nReading every account needs the staff rule on the users collection. If the rules were changed but not deployed, this is what it looks like.`}
            />
          </Card>
        ) : filtered.length === 0 ? (
          <Card>
            <EmptyState
              title="No accounts match"
              message={
                search || filter !== 'all'
                  ? 'Try a different search or filter.'
                  : 'Nobody has signed up yet.'
              }
            />
          </Card>
        ) : (
          filtered.map((account) => {
            const name = memberDisplayName(account);
            const role = (account.role ?? 'member') as Role;
            const membership = linkedMembership(account);
            const isSelf = account.uid === currentUser?.uid;
            const rowBusy = busy?.uid === account.uid;

            return (
              <Card key={account.uid} style={{ gap: Spacing.md }}>
                <View style={styles.row}>
                  <View style={[styles.avatar, { backgroundColor: brandMuted }]}>
                    <Text style={[styles.initials, { color: brand }]}>{initialsOf(name)}</Text>
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={[styles.name, { color: text }]} numberOfLines={1}>
                      {name}
                      {isSelf ? ' (you)' : ''}
                    </Text>
                    <Text style={{ color: muted, fontSize: FontSize.sm }} numberOfLines={1}>
                      {account.email ?? 'No email'}
                      {account.username ? ` · @${account.username}` : ''}
                    </Text>
                  </View>
                  <Badge label={role} tone={ROLE_TONES[role]} />
                </View>

                {membership ? (
                  <Pressable onPress={() => router.push(`/(admin)/members/${membership.id}`)}>
                    <Text style={{ color: brand, fontSize: FontSize.sm }}>
                      {membership.planName ?? 'Membership'} · expires{' '}
                      {formatDate(membership.endDate)} — view member
                    </Text>
                  </Pressable>
                ) : role === 'member' ? (
                  <View style={{ gap: Spacing.sm }}>
                    <Text style={{ color: muted, fontSize: FontSize.sm }}>
                      No membership yet. Until one is added they cannot check in and their
                      dashboard stays empty.
                    </Text>
                    <Button
                      title="Add membership"
                      variant="secondary"
                      onPress={() =>
                        router.push({
                          pathname: '/(admin)/members/new',
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
                ) : (
                  <Text style={{ color: muted, fontSize: FontSize.sm }}>
                    Runs the gym — no membership record needed.
                  </Text>
                )}

                {/*
                  Role controls are admin-only, and never shown for your own account: demoting
                  yourself is how the last admin locks everyone out. The callable refuses it
                  too — this just avoids offering a button that always fails.
                */}
                {myRole === 'admin' && !isSelf ? (
                  <View style={styles.roleRow}>
                    {(['member', 'staff', 'admin'] as Role[]).map((r) => (
                      <Button
                        key={r}
                        title={r}
                        variant={role === r ? 'primary' : 'ghost'}
                        fullWidth={false}
                        loading={rowBusy && busy?.role === r}
                        disabled={rowBusy || role === r}
                        style={styles.roleButton}
                        onPress={() => confirmRoleChange(account, r)}
                      />
                    ))}
                  </View>
                ) : null}
              </Card>
            );
          })
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  controls: { gap: Spacing.md, paddingHorizontal: Spacing.lg, paddingTop: Spacing.lg },
  chips: { gap: Spacing.sm, paddingRight: Spacing.lg },
  chip: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipLabel: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  list: { padding: Spacing.lg, gap: Spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: { fontSize: FontSize.md, fontWeight: FontWeight.bold },
  name: { fontSize: FontSize.md, fontWeight: FontWeight.semibold },
  roleRow: { flexDirection: 'row', gap: Spacing.sm },
  roleButton: { flex: 1, paddingHorizontal: Spacing.sm },
});
