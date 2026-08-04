import { useMemo } from 'react';

import { useCollection } from '@/hooks/useCollection';
import { useAllMembers } from '@/hooks/useMember';
import { q } from '@/lib/firestore';
import { memberDisplayName, sortByDisplayName } from '@/lib/names';
import type { Member, Role, UserDoc } from '@/types/models';

/**
 * Every registered account. Staff-only — see the `users` read rule in firestore.rules.
 *
 * Sorted client-side because the query carries no orderBy: an account written before the name
 * fields existed would otherwise be excluded from the result entirely rather than sorted last.
 */
export function useAllUsers() {
  const usersQuery = useMemo(() => q.allUsers(), []);
  const { data, loading, error } = useCollection<UserDoc>(usersQuery);
  const users = useMemo(() => sortByDisplayName(data), [data]);
  return { data: users, loading, error };
}

export type PendingAccount = UserDoc & {
  /** Display label, tolerant of accounts missing name fields. */
  name: string;
};

/**
 * Accounts that exist in Auth but hold no membership record.
 *
 * This is the gap that makes a freshly verified signup invisible to the gym: creating an
 * account and buying a membership are two different events. Sign-up writes `users/{uid}`;
 * only staff can write `members/{memberId}`, because only staff know which plan was paid for
 * and until when. So a new member signs up, verifies, sees "no membership linked", and never
 * appears on the admin roster — not a bug in either screen, but a step nobody was shown.
 *
 * Surfacing the list is what closes it: staff see who is waiting and convert them into members.
 */
export function usePendingAccounts() {
  const { data: users, loading: usersLoading, error: usersError } = useAllUsers();
  const { data: members, loading: membersLoading, error: membersError } = useAllMembers();

  const data = useMemo<PendingAccount[]>(() => {
    // Both links are checked. `uid` is the real one; email is a fallback for walk-ins created
    // at the front desk before the person signed up, so converting them does not duplicate.
    const linkedUids = new Set(
      members.map((member: Member) => member.uid).filter((uid): uid is string => Boolean(uid))
    );
    const linkedEmails = new Set(
      members
        .map((member: Member) => member.email?.trim().toLowerCase())
        .filter((email): email is string => Boolean(email))
    );

    return users
      .filter((user) => {
        if (user.uid && linkedUids.has(user.uid)) return false;
        const email = user.email?.trim().toLowerCase();
        if (email && linkedEmails.has(email)) return false;
        // Staff and admins run the gym; they are not waiting to be sold a membership.
        return (user.role ?? 'member') === 'member';
      })
      .map((user) => ({ ...user, name: memberDisplayName(user) }));
  }, [users, members]);

  return {
    data,
    loading: usersLoading || membersLoading,
    error: usersError ?? membersError,
  };
}

/** Accounts holding a staff or admin role, for the team list on the settings screen. */
export function useTeamAccounts() {
  const { data, loading, error } = useAllUsers();
  const team = useMemo(
    () => data.filter((user) => user.role === 'staff' || user.role === 'admin'),
    [data]
  );
  return { data: team, loading, error };
}

/**
 * Type-ahead for the team-access box: 3+ characters matches against email, username, and name.
 *
 * Three is the threshold because a shorter needle matches most of the roster, and showing an
 * admin fifty addresses is not a suggestion. Matching happens over the already-loaded listener,
 * so typing costs no reads.
 */
export function useAccountSearch(needle: string, limit = 5) {
  const { data, loading, error } = useAllUsers();

  const matches = useMemo(() => {
    const term = needle.trim().toLowerCase();
    if (term.length < 3) return [];
    return data
      .filter((user) => {
        const haystack = [user.email, user.username, memberDisplayName(user)]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return haystack.includes(term);
      })
      .slice(0, limit);
  }, [data, needle, limit]);

  return { data: matches, loading, error };
}

export type { Role, UserDoc };
