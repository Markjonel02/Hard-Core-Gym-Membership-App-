import { Redirect, Tabs } from 'expo-router';
import { SymbolView } from 'expo-symbols';

import { LoadingScreen } from '@/components/ui/LoadingScreen';
import { OverflowMenu } from '@/components/ui/OverflowMenu';
import { useAuth } from '@/context/AuthContext';
import { useClientOnlyValue } from '@/components/useClientOnlyValue';
import { useColorScheme } from '@/components/useColorScheme';
import { ADMIN_MENU_ITEMS } from '@/constants/AdminMenu';
import Colors from '@/constants/Colors';

/**
 * Staff/admin-only group. This guard is a UX affordance, not the security boundary —
 * firestore.rules independently rejects member-role reads of payments and stats.
 */
export default function AdminLayout() {
  const colorScheme = useColorScheme();
  const { user, isStaff, loading, emailVerified } = useAuth();
  // Hoisted above the guards on purpose: the web build of this hook uses useState/useEffect, so
  // calling it inside `screenOptions` below made its hook appear only on renders that got past
  // the redirects — which React reports as a changed hook order.
  const headerShown = useClientOnlyValue(false, true);

  if (loading) return <LoadingScreen />;
  if (!user) return <Redirect href="/(auth)/sign-in" />;
  if (!emailVerified) return <Redirect href="/verify-email" />;
  if (!isStaff) return <Redirect href="/(member)" />;

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: Colors[colorScheme].tint,
        tabBarInactiveTintColor: Colors[colorScheme].tabIconDefault,
        tabBarStyle: {
          backgroundColor: Colors[colorScheme].card,
          borderTopColor: Colors[colorScheme].border,
        },
        headerStyle: { backgroundColor: Colors[colorScheme].card },
        headerTintColor: Colors[colorScheme].text,
        headerShown,
        headerRight: () => <OverflowMenu items={ADMIN_MENU_ITEMS} />,
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Sales',
          tabBarIcon: ({ color }) => (
            <SymbolView
              name={{ ios: 'chart.bar.fill', android: 'bar_chart', web: 'bar_chart' }}
              tintColor={color}
              size={26}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="members"
        options={{
          title: 'Members',
          // The nested Stack draws its own header, menu included.
          headerShown: false,
          tabBarIcon: ({ color }) => (
            <SymbolView
              name={{ ios: 'person.2.fill', android: 'group', web: 'group' }}
              tintColor={color}
              size={26}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color }) => (
            <SymbolView
              name={{ ios: 'gearshape.fill', android: 'settings', web: 'settings' }}
              tintColor={color}
              size={26}
            />
          ),
        }}
      />

      {/*
        Registered so the routes exist and keep their header, but `href: null` keeps them out
        of the tab bar — they are reached from the ⋮ menu above. Omitting the screens entirely
        would still route, only without the group's header styling.
      */}
      <Tabs.Screen name="plans" options={{ title: 'Plans', href: null }} />
      <Tabs.Screen name="users" options={{ title: 'Accounts', href: null }} />
      <Tabs.Screen name="attendance" options={{ title: 'Attendance', href: null }} />
    </Tabs>
  );
}
