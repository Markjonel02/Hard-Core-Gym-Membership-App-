import { router } from 'expo-router';

import type { OverflowMenuItem } from '@/components/ui/OverflowMenu';

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
export const ADMIN_MENU_ITEMS: OverflowMenuItem[] = [
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
    hint: 'Check a member in',
    onPress: () => router.push('/scan'),
  },
  {
    label: 'Settings',
    icon: { ios: 'gearshape.fill', android: 'settings', web: 'settings' },
    hint: 'Team access and reminders',
    onPress: () => router.push('/(admin)/settings'),
  },
];
