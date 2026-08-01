import { Stack } from 'expo-router';

import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';

export default function MembersLayout() {
  const colorScheme = useColorScheme();

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: Colors[colorScheme].card },
        headerTintColor: Colors[colorScheme].text,
      }}>
      <Stack.Screen name="index" options={{ title: 'Members' }} />
      <Stack.Screen name="new" options={{ title: 'New member' }} />
      <Stack.Screen name="[id]" options={{ title: 'Member' }} />
    </Stack>
  );
}
