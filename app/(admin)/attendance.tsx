import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { NonMemberPassModal } from '@/components/NonMemberPassModal';
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
import { useAttendance, type AttendanceRow } from '@/hooks/useAttendance';
import { createNonMemberCheckIn, upsertNonMember } from '@/lib/firestore';
import { formatDate, initialsOf, toDate } from '@/lib/format';
import { passDisplayName, type NonMemberPassIdentity } from '@/lib/nonMembers';

type Filter = 'all' | 'member' | 'nonmember';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'member', label: 'Members' },
  { key: 'nonmember', label: 'Non-members' },
];

/** Groups rows under a day heading. Rows with an unresolved timestamp lead under "Just now". */
function groupByDay(rows: AttendanceRow[]) {
  const groups: { key: string; label: string; rows: AttendanceRow[] }[] = [];
  const today = new Date().toDateString();

  for (const row of rows) {
    const at = toDate(row.at);
    // A check-in written seconds ago has a serverTimestamp still resolving, so `at` is null.
    // That is the row the person at the desk is looking for, so it gets its own heading at the
    // top rather than being silently bucketed under an arbitrary date.
    const key = at ? at.toDateString() : 'pending';
    const label = !at
      ? 'Just now'
      : at.toDateString() === today
        ? 'Today'
        : formatDate(at, 'EEEE, MMM d, yyyy');

    const last = groups[groups.length - 1];
    if (last?.key === key) last.rows.push(row);
    else groups.push({ key, label, rows: [row] });
  }

  return groups;
}

/**
 * The attendance log — every visit by every kind of visitor, which nothing showed before.
 *
 * Check-ins were only ever read filtered to one member (`q.checkinsForMember`), so the gym could
 * see an individual's history but never the day's traffic. This is the whole-building view, and
 * the reason walk-ins were given a scannable pass at all: an attendance record that silently
 * omitted everyone without a membership would undercount the room.
 */
export default function Attendance() {
  const { user } = useAuth();
  const { data: rows, loading, error } = useAttendance();

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [walkInOpen, setWalkInOpen] = useState(false);

  const text = useThemeColor({}, 'text');
  const muted = useThemeColor({}, 'muted');
  const brand = useThemeColor({}, 'brand');
  const brandMuted = useThemeColor({}, 'brandMuted');
  const surface = useThemeColor({}, 'surface');
  const border = useThemeColor({}, 'border');

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (filter !== 'all' && row.kind !== filter) return false;
      if (!needle) return true;
      return row.name.toLowerCase().includes(needle);
    });
  }, [rows, search, filter]);

  const groups = useMemo(() => groupByDay(filtered), [filtered]);

  const todayCount = useMemo(() => {
    const today = new Date().toDateString();
    return rows.filter((row) => {
      const at = toDate(row.at);
      // Unresolved timestamps are counted as today — they were written moments ago by definition.
      return !at || at.toDateString() === today;
    }).length;
  }, [rows]);

  /**
   * Desk-side walk-in: writes the person's record and their attendance row together, for
   * someone standing at the counter without the app. Same path a scan takes, minus the camera.
   */
  const registerWalkIn = async (identity: Required<NonMemberPassIdentity>) => {
    await upsertNonMember(identity);
    await createNonMemberCheckIn(identity.id, passDisplayName(identity), user?.uid ?? 'unknown');
  };

  return (
    <Screen scroll={false}>
      <View style={styles.controls}>
        <View style={styles.headerRow}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[styles.title, { color: text }]}>Attendance</Text>
            <Text style={{ color: muted, fontSize: FontSize.sm }}>
              {todayCount} check-in{todayCount === 1 ? '' : 's'} today · {rows.length} total
            </Text>
          </View>
          <Button
            title="Add walk-in"
            variant="secondary"
            fullWidth={false}
            onPress={() => setWalkInOpen(true)}
          />
        </View>

        <Input
          placeholder="Search by name"
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
      </View>

      <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
        {loading ? (
          <SkeletonList rows={5} height={72} />
        ) : error ? (
          <Card>
            <EmptyState
              title="Could not load attendance"
              message={`${error.message}\n\nReading every check-in needs the staff rule on the checkins and nonMembers collections. If the rules were changed but not deployed, this is exactly what it looks like.`}
            />
          </Card>
        ) : groups.length === 0 ? (
          <Card>
            <EmptyState
              title="No check-ins yet"
              message={
                search || filter !== 'all'
                  ? 'Try a different search or filter.'
                  : 'Scan a member QR or log a walk-in and it appears here.'
              }
            />
          </Card>
        ) : (
          groups.map((group) => (
            <View key={group.key} style={{ gap: Spacing.sm }}>
              <Text style={[styles.dayHeading, { color: muted }]}>
                {group.label} · {group.rows.length}
              </Text>
              <Card padded={false}>
                {group.rows.map((row, index) => {
                  const at = toDate(row.at);
                  const isMember = row.kind === 'member';
                  return (
                    <View
                      key={row.id}
                      style={[
                        styles.row,
                        index > 0 && {
                          borderTopWidth: StyleSheet.hairlineWidth,
                          borderTopColor: border,
                        },
                      ]}>
                      <View
                        style={[
                          styles.avatar,
                          { backgroundColor: isMember ? brandMuted : surface },
                        ]}>
                        <Text
                          style={[styles.initials, { color: isMember ? brand : muted }]}>
                          {initialsOf(row.name)}
                        </Text>
                      </View>
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text style={[styles.name, { color: text }]} numberOfLines={1}>
                          {row.name}
                        </Text>
                        <Text style={{ color: muted, fontSize: FontSize.sm }}>
                          {at
                            ? at.toLocaleTimeString(undefined, {
                                hour: 'numeric',
                                minute: '2-digit',
                              })
                            : 'Saving…'}
                        </Text>
                      </View>
                      <Badge
                        label={isMember ? 'Member' : 'Walk-in'}
                        tone={isMember ? 'brand' : 'neutral'}
                      />
                    </View>
                  );
                })}
              </Card>
            </View>
          ))
        )}
      </ScrollView>

      <NonMemberPassModal
        visible={walkInOpen}
        mode="desk"
        onClose={() => setWalkInOpen(false)}
        onRegister={registerWalkIn}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  controls: { gap: Spacing.md, paddingHorizontal: Spacing.lg, paddingTop: Spacing.lg },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  title: { fontSize: FontSize.xxl, fontWeight: FontWeight.bold },
  chips: { gap: Spacing.sm, paddingRight: Spacing.lg },
  chip: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipLabel: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  list: { padding: Spacing.lg, gap: Spacing.lg },
  dayHeading: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: { fontSize: FontSize.sm, fontWeight: FontWeight.bold },
  name: { fontSize: FontSize.md, fontWeight: FontWeight.semibold },
});
