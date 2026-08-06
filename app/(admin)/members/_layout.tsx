import { Stack } from 'expo-router';

import { OverflowMenu } from '@/components/ui/OverflowMenu';
import { useAuth } from '@/context/AuthContext';
import { useColorScheme } from '@/components/useColorScheme';
import { adminMenuItems } from '@/constants/AdminMenu';
import Colors from '@/constants/Colors';

export default function MembersLayout() {
  const colorScheme = useColorScheme();
  const { role } = useAuth();

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: Colors[colorScheme].card },
        headerTintColor: Colors[colorScheme].text,
      }}>
      {/*
        Only the list carries the menu. On `new` and `[id]` the header's right side is where
        a save/edit action belongs, and a ⋮ that navigates away mid-form is a trap.
      */}
      <Stack.Screen
        name="index"
        options={{
          title: 'Members',
          headerRight: () => <OverflowMenu items={adminMenuItems(role)} />,
        }}
      />
      <Stack.Screen name="new" options={{ title: 'New member' }} />
      <Stack.Screen name="[id]" options={{ title: 'Member' }} />
    </Stack>
  );
}
