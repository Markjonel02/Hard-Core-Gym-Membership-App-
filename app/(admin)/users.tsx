import { useMemo, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { httpsCallable } from 'firebase/functions';

import { EditAccountModal } from '@/components/admin/EditAccountModal';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { OverflowMenu, type OverflowMenuItem } from '@/components/ui/OverflowMenu';
import { Screen } from '@/components/ui/Screen';
import { SkeletonList } from '@/components/ui/Skeleton';
import { useThemeColor } from '@/components/Themed';
import { useAuth } from '@/context/AuthContext';
import { FontSize, FontWeight, Radius, Spacing } from '@/constants/Theme';
import { useAllMembers } from '@/hooks/useMember';
import { useVisibleUsers } from '@/hooks/useUsers';
import { authErrorMessage, isFunctionMissing } from '@/lib/authErrors';
import { archiveMember, restoreMember, upsertUserProfile } from '@/lib/firestore';
import { functions } from '@/lib/firebase';
import { formatDate, initialsOf } from '@/lib/format';
import { memberDisplayName } from '@/lib/names';
import { makeAdminCommand, MAKE_ADMIN_AFTER, MAKE_ADMIN_HINT } from '@/lib/roleFallback';
import type { Member, Role, UserDoc } from '@/types/models';

type Filter = 'all' | 'pending' | 'members' | 'team' | 'archived';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'No membership' },
  { key: 'members', label: 'Members' },
  { key: 'team', label: 'Staff & admins' },
  { key: 'archived', label: 'Archived' },
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
  const { data: users, archived, loading, error } = useVisibleUsers();
  const { data: members } = useAllMembers();

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  /** Which button is spinning: the uid being changed and the role it is being changed to. */
  const [busy, setBusy] = useState<{ uid: string; role: Role } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  /** Selected uids for the bulk bar. A Set because the only questions asked are has/add/remove. */
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [editing, setEditing] = useState<UserDoc | null>(null);
  /**
   * The terminal fallback, shown only after the callable has actually been tried and answered
   * "not deployed". Holding the lines in state rather than deriving them keeps the block tied to
   * the attempt the admin just made, so it does not reappear on the next render for a different row.
   */
  const [fallback, setFallback] = useState<{ commands: string; count: number } | null>(null);

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

  const source = filter === 'archived' ? archived : users;

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return source.filter((account) => {
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
      if (filter === 'archived') return true;
      return true;
    });
    // linkedMembership closes over the two maps, which are the real dependencies.
  }, [source, search, filter, membershipByUid, membershipByEmail]);

  const changeRole = async (account: UserDoc, nextRole: Role) => {
    setActionError(null);
    setMessage(null);
    setFallback(null);
    setBusy({ uid: account.uid, role: nextRole });
    try {
      const call = httpsCallable(functions, 'setRole');
      await call({ uid: account.uid, role: nextRole });
      setMessage(
        `${memberDisplayName(account)} is now ${nextRole}. The change applies the next time they sign in.`
      );
    } catch (err) {
      /*
       * A missing deployment is not an error the admin can act on, so it is answered with the
       * command that does the same job instead of a sentence naming a fix they cannot perform.
       * A genuine rejection — self-demotion, unknown address — still shows the server's own message.
       */
      if (isFunctionMissing(err) && account.email) {
        setFallback({ commands: makeAdminCommand(account.email, nextRole), count: 1 });
      } else {
        setActionError(authErrorMessage(err));
      }
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

  const confirmArchive = (account: UserDoc) => {
    const name = memberDisplayName(account);
    const membership = linkedMembership(account);
    const prompt = membership
      ? `Archive ${name}? Their membership will be cancelled and hidden from the roster. Payment and attendance history is kept. Their sign-in credentials stay active — removing those needs the Firebase console.`
      : `Archive ${name}'s account? They will be hidden from this list. Their sign-in credentials stay active — removing those needs the Firebase console.`;

    if (Platform.OS === 'web') {
      if (window.confirm(prompt)) void doArchive(account);
      return;
    }
    Alert.alert('Archive account', prompt, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Archive', style: 'destructive', onPress: () => void doArchive(account) },
    ]);
  };

  const doArchive = async (account: UserDoc) => {
    const membership = linkedMembership(account);
    setActionError(null);
    setMessage(null);
    try {
      if (membership) await archiveMember(membership.id);
      if (account.uid) await upsertUserProfile(account.uid, { archived: true });
      setMessage(`Archived ${memberDisplayName(account)}.`);
      setSelected(new Set());
    } catch (err) {
      console.error('[accounts] archive failed', err);
      setActionError(authErrorMessage(err));
    }
  };

  const confirmBulkArchive = () => {
    const count = selected.size;
    const prompt = `Archive ${count} account${count === 1 ? '' : 's'}? Memberships are cancelled and hidden. Payment and attendance history is kept. Sign-in credentials stay active.`;

    if (Platform.OS === 'web') {
      if (window.confirm(prompt)) void doBulkArchive();
      return;
    }
    Alert.alert('Archive accounts', prompt, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Archive', style: 'destructive', onPress: () => void doBulkArchive() },
    ]);
  };

  const doBulkArchive = async () => {
    setActionError(null);
    setMessage(null);
    setBulkBusy(true);
    const failures: string[] = [];

    for (const uid of selected) {
      const account = users.find((u) => u.uid === uid) ?? archived.find((u) => u.uid === uid);
      if (!account) continue;
      const membership = linkedMembership(account);
      try {
        if (membership) await archiveMember(membership.id);
        if (account.uid) await upsertUserProfile(account.uid, { archived: true });
      } catch (err) {
        console.error('[accounts] bulk archive failed for', account.email, err);
        failures.push(memberDisplayName(account));
      }
    }

    setBulkBusy(false);
    if (failures.length === 0) {
      setMessage(`Archived ${selected.size} account${selected.size === 1 ? '' : 's'}.`);
    } else {
      setActionError(`Archived ${selected.size - failures.length}, failed for: ${failures.join(', ')}`);
    }
    setSelected(new Set());
  };

  const doBulkPromote = async (role: Role) => {
    setActionError(null);
    setMessage(null);
    setFallback(null);
    setBulkBusy(true);

    const entries = Array.from(selected)
      .map((uid) => users.find((u) => u.uid === uid))
      .filter((account): account is UserDoc => Boolean(account?.email));

    const failures: string[] = [];
    let missing = false;

    for (const account of entries) {
      try {
        const call = httpsCallable(functions, 'setRole');
        await call({ uid: account.uid, role });
      } catch (err) {
        if (isFunctionMissing(err)) {
          missing = true;
          break;
        }
        console.error('[accounts] bulk promote failed for', account.email, err);
        failures.push(memberDisplayName(account));
      }
    }

    setBulkBusy(false);

    if (missing) {
      const commands = entries.map((a) => makeAdminCommand(a.email!, role)).join('\n');
      setFallback({ commands, count: entries.length });
      return;
    }

    if (failures.length === 0) {
      setMessage(
        `Promoted ${entries.length} account${entries.length === 1 ? '' : 's'} to ${role}. Changes apply on next sign-in.`
      );
    } else {
      setActionError(`Promoted ${entries.length - failures.length}, failed for: ${failures.join(', ')}`);
    }
    setSelected(new Set());
  };

  const confirmBulkPromote = (role: Role) => {
    const count = selected.size;
    const prompt = `Give ${count} account${count === 1 ? '' : 's'} ${role} access to the admin dashboard?`;

    if (Platform.OS === 'web') {
      if (window.confirm(prompt)) void doBulkPromote(role);
      return;
    }
    Alert.alert('Change role', prompt, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Confirm', onPress: () => void doBulkPromote(role) },
    ]);
  };

  const doRestore = async (account: UserDoc) => {
    const membership = linkedMembership(account);
    setActionError(null);
    setMessage(null);
    try {
      if (membership) await restoreMember(membership.id);
      if (account.uid) await upsertUserProfile(account.uid, { archived: false });
      setMessage(
        `Restored ${memberDisplayName(account)}.${
          membership ? ' Their membership is still cancelled — renew it to grant access.' : ''
        }`
      );
      setSelected(new Set());
    } catch (err) {
      console.error('[accounts] restore failed', err);
      setActionError(authErrorMessage(err));
    }
  };

  const toggleSelection = (uid: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((a) => a.uid)));
    }
  };

  const allSelected = filtered.length > 0 && selected.size === filtered.length;

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
            const isSelected = filter === item.key;
            return (
              <Pressable
                key={item.key}
                onPress={() => setFilter(item.key)}
                style={[
                  styles.chip,
                  {
                    backgroundColor: isSelected ? brandMuted : surface,
                    borderColor: isSelected ? brand : border,
                  },
                ]}>
                <Text style={[styles.chipLabel, { color: isSelected ? brand : muted }]}>
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {selected.size > 0 && myRole === 'admin' ? (
          <View style={[styles.bulkBar, { backgroundColor: surface, borderColor: border }]}>
            <Pressable onPress={toggleAll} style={styles.bulkCheckRow}>
              <View
                style={[
                  styles.checkbox,
                  {
                    borderColor: allSelected ? brand : border,
                    backgroundColor: allSelected ? brand : 'transparent',
                  },
                ]}>
                {allSelected ? <Text style={styles.checkmark}>✓</Text> : null}
              </View>
              <Text style={{ color: text, fontSize: FontSize.sm }}>
                {selected.size} selected
              </Text>
            </Pressable>
            <View style={styles.bulkActions}>
              <Button
                title="Archive"
                variant="ghost"
                fullWidth={false}
                loading={bulkBusy}
                style={styles.bulkButton}
                onPress={confirmBulkArchive}
              />
              <Button
                title="Make staff"
                variant="ghost"
                fullWidth={false}
                loading={bulkBusy}
                style={styles.bulkButton}
                onPress={() => confirmBulkPromote('staff')}
              />
              <Button
                title="Make admin"
                variant="ghost"
                fullWidth={false}
                loading={bulkBusy}
                style={styles.bulkButton}
                onPress={() => confirmBulkPromote('admin')}
              />
            </View>
          </View>
        ) : null}

        {message ? <Text style={{ color: success }}>{message}</Text> : null}
        {actionError ? <Text style={{ color: danger }}>{actionError}</Text> : null}
        {fallback ? (
          <View style={{ gap: Spacing.sm }}>
            <Text style={{ color: muted, fontSize: FontSize.sm }}>{MAKE_ADMIN_HINT}</Text>
            <View style={[styles.codeBlock, { backgroundColor: surface, borderColor: border }]}>
              <Text style={[styles.code, { color: text }]} selectable>
                {fallback.commands}
              </Text>
            </View>
            <Text style={{ color: muted, fontSize: FontSize.sm }}>{MAKE_ADMIN_AFTER}</Text>
          </View>
        ) : null}
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
            const isSelected = selected.has(account.uid);
            const isArchived = filter === 'archived';

            const menuItems: OverflowMenuItem[] = [
              {
                label: 'View',
                icon: { ios: 'eye', android: 'visibility', web: 'visibility' },
                hint: membership ? 'Open member detail' : 'Add membership',
                onPress: () => {
                  if (membership) {
                    router.push(`/(admin)/members/${membership.id}`);
                  } else {
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
                    });
                  }
                },
              },
              {
                label: 'Edit',
                icon: { ios: 'pencil', android: 'edit', web: 'edit' },
                hint: 'Update details',
                onPress: () => setEditing(account),
              },
            ];

            if (isArchived) {
              menuItems.push({
                label: 'Restore',
                icon: { ios: 'arrow.uturn.backward', android: 'restore', web: 'restore' },
                hint: 'Bring back to active',
                onPress: () => doRestore(account),
              });
            } else {
              menuItems.push({
                label: 'Archive',
                icon: { ios: 'archivebox', android: 'archive', web: 'archive' },
                hint: 'Hide from roster',
                destructive: true,
                onPress: () => confirmArchive(account),
              });
            }

            return (
              <Card key={account.uid} style={{ gap: Spacing.md }}>
                <View style={styles.row}>
                  {myRole === 'admin' && !isArchived ? (
                    <Pressable onPress={() => toggleSelection(account.uid)} hitSlop={8}>
                      <View
                        style={[
                          styles.checkbox,
                          {
                            borderColor: isSelected ? brand : border,
                            backgroundColor: isSelected ? brand : 'transparent',
                          },
                        ]}>
                        {isSelected ? <Text style={styles.checkmark}>✓</Text> : null}
                      </View>
                    </Pressable>
                  ) : null}
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
                  <OverflowMenu
                    variant="inline"
                    title={name}
                    items={menuItems}
                    accessibilityLabel={`Actions for ${name}`}
                  />
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

      <EditAccountModal
        visible={Boolean(editing)}
        onClose={() => setEditing(null)}
        account={editing}
        member={editing ? linkedMembership(editing) : null}
        onSaved={(msg) => {
          setMessage(msg);
          setEditing(null);
        }}
      />
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
  bulkBar: {
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    gap: Spacing.md,
  },
  bulkCheckRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  bulkActions: { flexDirection: 'row', gap: Spacing.sm },
  bulkButton: { paddingHorizontal: Spacing.sm },
  codeBlock: {
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  code: { fontSize: FontSize.sm, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  list: { padding: Spacing.lg, gap: Spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkmark: { color: '#fff', fontSize: FontSize.sm, fontWeight: FontWeight.bold },
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
