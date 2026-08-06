import { router } from 'expo-router';

import type { OverflowMenuItem } from '@/components/ui/OverflowMenu';
import type { Role } from '@/types/models';

/**
 * The admin destinations that live in the header ⋮ menu rather than the tab bar.
 *
 * Four tabs made every one of them cramped, and Plans is not a daily screen — it is opened
 * when prices change, a few times a year. Sales, Members, and Settings are what the front
 * desk actually touches, so those keep the bar and the rest moves behind the menu.
 *
 * Kept in its own module, not in `app/(admin)/_layout.tsx`, so the nested members Stack can
 * show the same menu without importing a route file.
 */
const SHARED_ITEMS: OverflowMenuItem[] = [
  {
    label: 'Plans',
    icon: { ios: 'tag.fill', android: 'sell', web: 'sell' },
    hint: 'Prices, durations, and perks',
    onPress: () => router.push('/(admin)/plans'),
  },
  {
    label: 'Accounts',
    icon: { ios: 'person.badge.key.fill', android: 'manage_accounts', web: 'manage_accounts' },
    hint: 'Everyone who can sign in',
    onPress: () => router.push('/(admin)/users'),
  },
  {
    label: 'QR scanner',
    icon: { ios: 'qrcode.viewfinder', android: 'qr_code_scanner', web: 'qr_code_scanner' },
    hint: 'Check anyone in',
    onPress: () => router.push('/scan'),
  },
  {
    label: 'Attendance',
    icon: { ios: 'list.clipboard.fill', android: 'checklist', web: 'checklist' },
    hint: 'Every visit, members and walk-ins',
    onPress: () => router.push('/(admin)/attendance'),
  },
  {
    label: 'Settings',
    icon: { ios: 'gearshape.fill', android: 'settings', web: 'settings' },
    hint: 'Team access and reminders',
    onPress: () => router.push('/(admin)/settings'),
  },
];

/** Admins only. Staff can see the gym's data; who looked at it is the owner's business. */
const SECURITY_LOGS: OverflowMenuItem = {
  label: 'Security logs',
  icon: { ios: 'lock.doc.fill', android: 'policy', web: 'policy' },
  hint: 'Sign-ins, screens opened, and changes',
  onPress: () => router.push('/(admin)/securityLogs'),
};

/**
 * The menu for a given role.
 *
 * A function rather than the constant this used to be, because one entry is admin-only. Hiding it
 * from staff is presentation only — `firestore.rules` denies the read outright, so a staff account
 * that reached the route by typing it would find an empty screen with a permissions notice.
 */
export function adminMenuItems(role: Role | null): OverflowMenuItem[] {
  return role === 'admin' ? [...SHARED_ITEMS, SECURITY_LOGS] : SHARED_ITEMS;
}
