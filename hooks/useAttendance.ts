import { useMemo } from 'react';

import { useCollection } from '@/hooks/useCollection';
import { q } from '@/lib/firestore';
import { sortByDateDesc } from '@/lib/format';
import { memberDisplayName, sortByDisplayName } from '@/lib/names';
import type { CheckIn, NonMember } from '@/types/models';

/** Every walk-in on record. Staff-only — see the `nonMembers` rule in firestore.rules. */
export function useAllNonMembers() {
  const nonMembersQuery = useMemo(() => q.allNonMembers(), []);
  const { data, loading, error } = useCollection<NonMember>(nonMembersQuery);
  const sorted = useMemo(() => sortByDisplayName(data), [data]);
  return { data: sorted, loading, error };
}

export type AttendanceRow = CheckIn & {
  /** Resolved for display: the live record's name if we have one, else the name at scan time. */
  name: string;
};

/**
 * The full attendance log, newest first, covering members and walk-ins alike.
 *
 * Sorted in memory rather than with `orderBy('at')` for the reason documented at
 * `lib/firestore.ts:63-76` — and it matters more here than anywhere else: a check-in written
 * seconds ago still has an unresolved `serverTimestamp`, and an ordered query would drop exactly
 * the row the person at the desk just created and is looking for.
 */
export function useAttendance() {
  const checkinsQuery = useMemo(() => q.allCheckins(), []);
  const { data, loading, error } = useCollection<CheckIn>(checkinsQuery);
  const { data: nonMembers, loading: nonMembersLoading } = useAllNonMembers();

  const rows = useMemo<AttendanceRow[]>(() => {
    const namesById = new Map(nonMembers.map((nm) => [nm.id, memberDisplayName(nm)]));

    return sortByDateDesc(data, 'at').map((entry) => ({
      ...entry,
      // Rows predating the `kind` field were all members; default rather than render "undefined".
      kind: entry.kind ?? 'member',
      // Prefer the current record so a corrected spelling propagates to past visits; fall back to
      // the name captured at scan time, which is all a member row ever carries.
      name:
        (entry.nonMemberId ? namesById.get(entry.nonMemberId) : null) ??
        entry.memberName ??
        'Unknown visitor',
    }));
  }, [data, nonMembers]);

  return { data: rows, loading: loading || nonMembersLoading, error };
}
