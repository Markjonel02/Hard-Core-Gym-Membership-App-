/**
 * Records which screens the signed-in person opens, for the security log.
 *
 * Mounted once at the root rather than per screen: a hook in each route file would be a dozen
 * places to forget, and expo-router already exposes the current path globally. Nothing is written
 * here — `recordScreen` buffers in memory and the trail is flushed as one document when the
 * session ends. See lib/securityLog.ts for why it is batched.
 */
import { usePathname } from 'expo-router';
import { useEffect } from 'react';

import { recordScreen } from '@/lib/securityLog';

/**
 * Route paths as a person would name them. An admin reading the log should see "Check-in", not
 * "/(member)/checkin" — the point of the trail is that someone can act on it.
 *
 * Anything unlisted falls back to the raw path, so a new route shows up as itself rather than
 * disappearing from the log until someone remembers to add it here.
 */
const SCREEN_NAMES: Record<string, string> = {
  '/': 'Launch',
  '/sign-in': 'Sign in',
  '/forgot-password': 'Forgot password',
  '/verify-email': 'Verify email',
  '/scan': 'QR scanner',

  '/(member)': 'Member home',
  '/(member)/': 'Member home',
  '/membership': 'Membership',
  '/checkin': 'Check-in',
  '/profile': 'Profile',

  '/(admin)': 'Sales dashboard',
  '/(admin)/': 'Sales dashboard',
  '/members': 'Members',
  '/members/new': 'New member',
  '/plans': 'Plans',
  '/users': 'Accounts',
  '/attendance': 'Attendance',
  '/settings': 'Settings',
  '/securityLogs': 'Security logs',
};

export function screenLabel(pathname: string): string {
  const known = SCREEN_NAMES[pathname];
  if (known) return known;
  // `/members/aBc123` — the id is noise in a log, and worse, it is a second copy of member data
  // sitting in a collection that does not need it.
  if (/^\/members\/[^/]+$/.test(pathname)) return 'Member detail';
  return pathname;
}

export function useScreenLog() {
  const pathname = usePathname();

  useEffect(() => {
    recordScreen(screenLabel(pathname));
  }, [pathname]);
}
