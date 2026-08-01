import { Redirect, Tabs } from 'expo-router';
import { SymbolView } from 'expo-symbols';

import { LoadingScreen } from '@/components/ui/LoadingScreen';
import { useAuth } from '@/context/AuthContext';
import { useClientOnlyValue } from '@/components/useClientOnlyValue';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';

/**
 * Staff/admin-only group. This guard is a UX affordance, not the security boundary —
 * firestore.rules independently rejects member-role reads of payments and stats.
 */
export default function AdminLayout() {
  const colorScheme = useColorScheme();
  const { user, isStaff, loading } = useAuth();

  if (loading) return <LoadingScreen />;
  if (!user) return <Redirect href="/(auth)/sign-in" />;
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
        headerShown: useClientOnlyValue(false, true),
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
        name="plans"
        options={{
          title: 'Plans',
          tabBarIcon: ({ color }) => (
            <SymbolView
              name={{ ios: 'tag.fill', android: 'sell', web: 'sell' }}
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
    </Tabs>
  );
}
