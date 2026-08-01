import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Screen } from '@/components/ui/Screen';
import { SkeletonList } from '@/components/ui/Skeleton';
import { useThemeColor } from '@/components/Themed';
import { FontSize, FontWeight, Radius, Spacing } from '@/constants/Theme';
import { useAllMembers } from '@/hooks/useMember';
import { daysUntil, formatDate, initialsOf, membershipTone } from '@/lib/format';
import type { MemberStatus } from '@/types/models';

type Filter = 'all' | MemberStatus | 'expiring';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'expiring', label: 'Expiring' },
  { key: 'expired', label: 'Expired' },
  { key: 'frozen', label: 'Frozen' },
];

export default function MembersList() {
  const { data: members, loading } = useAllMembers();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const text = useThemeColor({}, 'text');
  const muted = useThemeColor({}, 'muted');
  const brand = useThemeColor({}, 'brand');
  const brandMuted = useThemeColor({}, 'brandMuted');
  const surface = useThemeColor({}, 'surface');
  const border = useThemeColor({}, 'border');

  // Client-side filtering: Firestore can't do substring search, and a single gym's
  // roster is small enough to filter in memory off the existing live listener.
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return members.filter((member) => {
      if (needle) {
        const haystack = `${member.fullName} ${member.email} ${member.phone}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      if (filter === 'all') return true;
      if (filter === 'expiring') {
        const days = daysUntil(member.endDate);
        return member.status === 'active' && days !== null && days <= 90;
      }
      return member.status === filter;
    });
  }, [members, search, filter]);

  return (
    <Screen scroll={false}>
      <View style={styles.controls}>
        <Input
          placeholder="Search name, email, or phone"
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
                <Text
                  style={[
                    styles.chipLabel,
                    { color: selected ? brand : muted },
                  ]}>
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <Button title="+ Add member" onPress={() => router.push('/(admin)/members/new')} />
      </View>

      <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
        {loading ? (
          <SkeletonList rows={5} height={72} />
        ) : filtered.length === 0 ? (
          <Card>
            <EmptyState
              title="No members match"
              message={
                search || filter !== 'all'
                  ? 'Try a different search or filter.'
                  : 'Add your first member to get started.'
              }
              actionLabel={search || filter !== 'all' ? undefined : 'Add member'}
              onAction={
                search || filter !== 'all'
                  ? undefined
                  : () => router.push('/(admin)/members/new')
              }
            />
          </Card>
        ) : (
          filtered.map((member) => {
            const days = daysUntil(member.endDate);
            return (
              <Pressable
                key={member.id}
                onPress={() => router.push(`/(admin)/members/${member.id}`)}>
                {({ pressed }) => (
                  <Card style={[styles.memberRow, { opacity: pressed ? 0.7 : 1 }]}>
                    <View style={[styles.avatar, { backgroundColor: brandMuted }]}>
                      <Text style={[styles.initials, { color: brand }]}>
                        {initialsOf(member.fullName)}
                      </Text>
                    </View>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={[styles.name, { color: text }]} numberOfLines={1}>
                        {member.fullName}
                      </Text>
                      <Text style={{ color: muted, fontSize: FontSize.sm }} numberOfLines={1}>
                        {member.planName} · expires {formatDate(member.endDate)}
                      </Text>
                    </View>
                    <Badge
                      label={
                        member.status === 'active' && days !== null && days <= 90
                          ? `${days}d`
                          : member.status
                      }
                      tone={membershipTone(member.status, days)}
                    />
                  </Card>
                )}
              </Pressable>
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
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  initials: { fontSize: FontSize.md, fontWeight: FontWeight.bold },
  name: { fontSize: FontSize.md, fontWeight: FontWeight.semibold },
});
