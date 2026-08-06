import { Platform } from 'react-native';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Pager } from '@/components/ui/Pager';
import { Screen } from '@/components/ui/Screen';
import { SkeletonList } from '@/components/ui/Skeleton';
import { useThemeColor } from '@/components/Themed';
import { FontSize, FontWeight, Radius, Spacing } from '@/constants/Theme';
import { usePagination, PAGE_SIZE } from '@/hooks/usePagination';
import { useCollection } from '@/hooks/useCollection';
import {
  exportSecurityLogsCsv,
  securityLogRows,
  SECURITY_LOG_HEADERS,
} from '@/lib/csv';
import { q } from '@/lib/firestore';
import { formatDate, sortByDateDesc, toDate } from '@/lib/format';
import { printTable } from '@/lib/printPdf';
import type { SecurityLog, SecurityLogType } from '@/types/models';

type Window = { key: string; label: string; days: number };

/**
 * The read is bounded by date and nothing else. `securityLogs` grows with every session and has no
 * retention policy — Firestore TTL is not on the Spark plan — so an unbounded listener would get
 * slower every week the gym operates.
 */
const WINDOWS: Window[] = [
  { key: 'today', label: 'Today', days: 1 },
  { key: '7d', label: '7 days', days: 7 },
  { key: '30d', label: '30 days', days: 30 },
];

type Filter = 'all' | SecurityLogType;

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'login', label: 'Sign-ins' },
  { key: 'logout', label: 'Sign-outs' },
  { key: 'action', label: 'Changes' },
  { key: 'scan', label: 'Check-ins' },
];

const TYPE_META: Record<SecurityLogType, { label: string; tone: BadgeTone }> = {
  login: { label: 'Sign-in', tone: 'success' },
  logout: { label: 'Sign-out', tone: 'neutral' },
  action: { label: 'Change', tone: 'warning' },
  scan: { label: 'Check-in', tone: 'brand' },
};

/** The one-line description under the name. What this row actually says happened. */
function summarise(log: SecurityLog): string {
  switch (log.type) {
    case 'login':
      return 'Signed in';
    case 'logout': {
      const how = log.reason === 'idle' ? 'Signed out (idle timeout)' : 'Signed out';
      const count = log.screens?.length ?? 0;
      return count ? `${how} · ${count} screen${count === 1 ? '' : 's'}` : how;
    }
    default:
      return [log.action, log.detail].filter(Boolean).join(' · ') || '—';
  }
}

/** Same day-bucketing as the attendance log, so the two screens read the same way. */
function groupByDay(rows: SecurityLog[]) {
  const groups: { key: string; label: string; rows: SecurityLog[] }[] = [];
  const today = new Date().toDateString();

  for (const row of rows) {
    const at = toDate(row.at);
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
 * The audit trail: who signed in, what they opened, what they changed, and when they left.
 *
 * Admin-only, and enforced in `firestore.rules` rather than here — the ⋮ entry is simply hidden
 * from staff. Rows are written by `lib/securityLog.ts` and can never be edited or deleted by
 * anyone holding a client credential, which is what makes the trail worth reading.
 */
export default function SecurityLogs() {
  const [windowKey, setWindowKey] = useState('7d');
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const text = useThemeColor({}, 'text');
  const muted = useThemeColor({}, 'muted');
  const brand = useThemeColor({}, 'brand');
  const brandMuted = useThemeColor({}, 'brandMuted');
  const surface = useThemeColor({}, 'surface');
  const border = useThemeColor({}, 'border');

  const activeWindow = WINDOWS.find((w) => w.key === windowKey) ?? WINDOWS[1];

  /**
   * Rebuilt only when the window changes — `useCollection` re-subscribes on a new Query object.
   * The boundary is midnight-aligned rather than "N × 24h ago" so "Today" means today, and so the
   * memo does not produce a different `since` on every render the way `new Date()` would.
   */
  const logsQuery = useMemo(() => {
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    since.setDate(since.getDate() - (activeWindow.days - 1));
    return q.securityLogsSince(since);
  }, [activeWindow.days]);

  const { data, loading, error } = useCollection<SecurityLog>(logsQuery);

  const sorted = useMemo(() => sortByDateDesc(data, 'at'), [data]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return sorted.filter((log) => {
      if (filter !== 'all' && log.type !== filter) return false;
      if (!needle) return true;
      // Screens are searched too: "who opened Sales this week" is the question this screen exists
      // to answer, and that word appears nowhere else on the row.
      return [log.who, log.action, log.detail, ...(log.screens ?? []).map((s) => s.name)]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(needle));
    });
  }, [sorted, filter, search]);

  const paged = usePagination(
    filtered,
    PAGE_SIZE,
    `${windowKey}:${filter}:${search.trim().toLowerCase()}`
  );

  const groups = useMemo(() => groupByDay(paged.pageRows), [paged.pageRows]);

  /**
   * Exports carry `filtered`, not `paged.pageRows` and not `data` — the filters the admin set are
   * the report they are asking for, and handing them page 3 of it would be a surprise.
   */
  const subtitle = [
    `${activeWindow.label} · ${filtered.length} event${filtered.length === 1 ? '' : 's'}`,
    filter === 'all' ? null : FILTERS.find((f) => f.key === filter)?.label,
    search.trim() ? `matching "${search.trim()}"` : null,
    `exported ${formatDate(new Date(), "MMM d, yyyy 'at' h:mm a")}`,
  ]
    .filter(Boolean)
    .join(' · ');

  const canExport = Platform.OS === 'web' && filtered.length > 0;

  const onPrint = () =>
    printTable({
      title: 'Hardcore Gym — security logs',
      subtitle,
      headers: SECURITY_LOG_HEADERS,
      rows: securityLogRows(filtered),
    });

  const chip = (selected: boolean) => [
    styles.chip,
    { backgroundColor: selected ? brandMuted : surface, borderColor: selected ? brand : border },
  ];

  return (
    <Screen scroll={false}>
      <View style={styles.controls}>
        <View style={{ gap: 2 }}>
          <Text style={[styles.title, { color: text }]}>Security logs</Text>
          <Text style={{ color: muted, fontSize: FontSize.sm }}>
            Sign-ins, screens opened, and every change made
          </Text>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {WINDOWS.map((item) => (
            <Pressable key={item.key} onPress={() => setWindowKey(item.key)} style={chip(windowKey === item.key)}>
              <Text style={[styles.chipLabel, { color: windowKey === item.key ? brand : muted }]}>
                {item.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        <Input
          placeholder="Search by person, action, or screen"
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
          autoCorrect={false}
        />

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {FILTERS.map((item) => (
            <Pressable key={item.key} onPress={() => setFilter(item.key)} style={chip(filter === item.key)}>
              <Text style={[styles.chipLabel, { color: filter === item.key ? brand : muted }]}>
                {item.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        {/* Both exports are web-only, matching the payments CSV button on the sales dashboard. */}
        {canExport ? (
          <View style={styles.exports}>
            <Button
              title="Export CSV"
              variant="secondary"
              fullWidth={false}
              onPress={() => exportSecurityLogsCsv(filtered)}
            />
            <Button title="Print / PDF" variant="secondary" fullWidth={false} onPress={onPrint} />
          </View>
        ) : null}
      </View>

      <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
        {loading ? (
          <SkeletonList rows={5} height={72} />
        ) : error ? (
          <Card>
            <EmptyState
              title="Could not load security logs"
              message={`${error.message}\n\nThis collection is admin-only. A staff account is denied by design; if you are an admin and still see this, the securityLogs rule may not be deployed yet.`}
            />
          </Card>
        ) : groups.length === 0 ? (
          <Card>
            <EmptyState
              title="Nothing logged yet"
              message={
                search || filter !== 'all'
                  ? 'Try a different search, filter, or date range.'
                  : `No activity in the last ${activeWindow.label.toLowerCase()}. Sign-ins and changes appear here as they happen.`
              }
            />
          </Card>
        ) : (
          <>
            {groups.map((group) => (
              <View key={group.key} style={{ gap: Spacing.sm }}>
                <Text style={[styles.dayHeading, { color: muted }]}>
                  {group.label} · {group.rows.length}
                </Text>
                <Card padded={false}>
                  {group.rows.map((log, index) => {
                    const at = toDate(log.at);
                    const meta = TYPE_META[log.type] ?? { label: log.type, tone: 'neutral' as const };
                    const trail = log.screens ?? [];
                    const isOpen = expanded === log.id;

                    return (
                      <Pressable
                        key={log.id}
                        // Only sessions with a trail expand; a tap that does nothing visible on
                        // every other row would read as a broken control.
                        disabled={trail.length === 0}
                        onPress={() => setExpanded(isOpen ? null : log.id)}
                        style={[
                          styles.row,
                          index > 0 && {
                            borderTopWidth: StyleSheet.hairlineWidth,
                            borderTopColor: border,
                          },
                        ]}>
                        <View style={styles.rowTop}>
                          <View style={{ flex: 1, gap: 2 }}>
                            <Text style={[styles.name, { color: text }]} numberOfLines={1}>
                              {log.who || 'Unknown'}
                              {log.role ? (
                                <Text style={{ color: muted, fontWeight: FontWeight.regular }}>
                                  {'  '}
                                  {log.role}
                                </Text>
                              ) : null}
                            </Text>
                            <Text style={{ color: muted, fontSize: FontSize.sm }}>
                              {summarise(log)}
                            </Text>
                          </View>
                          <View style={{ alignItems: 'flex-end', gap: Spacing.xs }}>
                            <Badge label={meta.label} tone={meta.tone} />
                            <Text style={{ color: muted, fontSize: FontSize.xs }}>
                              {at
                                ? at.toLocaleTimeString(undefined, {
                                    hour: 'numeric',
                                    minute: '2-digit',
                                  })
                                : 'Saving…'}
                            </Text>
                          </View>
                        </View>

                        {trail.length > 0 ? (
                          isOpen ? (
                            <View style={[styles.trail, { borderLeftColor: border }]}>
                              {trail.map((visit, i) => (
                                <Text
                                  key={`${visit.at}-${i}`}
                                  style={{ color: muted, fontSize: FontSize.sm }}>
                                  {new Date(visit.at).toLocaleTimeString(undefined, {
                                    hour: 'numeric',
                                    minute: '2-digit',
                                  })}
                                  {'  '}
                                  {visit.name}
                                </Text>
                              ))}
                            </View>
                          ) : (
                            <Text style={{ color: brand, fontSize: FontSize.xs }}>
                              Tap to see the screens visited
                            </Text>
                          )
                        ) : null}
                      </Pressable>
                    );
                  })}
                </Card>
              </View>
            ))}
            <Pager pagination={paged} label="events" style={{ borderTopWidth: 0 }} />
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  controls: { gap: Spacing.md, paddingHorizontal: Spacing.lg, paddingTop: Spacing.lg },
  title: { fontSize: FontSize.xxl, fontWeight: FontWeight.bold },
  chips: { gap: Spacing.sm, paddingRight: Spacing.lg },
  chip: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipLabel: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  exports: { flexDirection: 'row', gap: Spacing.sm },
  list: { padding: Spacing.lg, gap: Spacing.lg },
  dayHeading: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  row: {
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md },
  name: { fontSize: FontSize.md, fontWeight: FontWeight.semibold },
  trail: {
    gap: 2,
    paddingLeft: Spacing.md,
    marginLeft: Spacing.xs,
    borderLeftWidth: StyleSheet.hairlineWidth,
  },
});
