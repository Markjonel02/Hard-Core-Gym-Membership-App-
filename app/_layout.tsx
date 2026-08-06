import { useFonts } from 'expo-font';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import 'react-native-reanimated';

import { AuthProvider } from '@/context/AuthContext';
import { IdleTimeout } from '@/components/IdleTimeout';
import { useColorScheme } from '@/components/useColorScheme';
import { useScreenLog } from '@/hooks/useScreenLog';

export {
  // Catch any errors thrown by the Layout component.
  ErrorBoundary,
} from 'expo-router';

export const unstable_settings = {
  initialRouteName: 'index',
};

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
  });

  // Expo Router uses Error Boundaries to catch errors in the navigation tree.
  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  if (!loaded) {
    return null;
  }

  return <RootLayoutNav />;
}

function RootLayoutNav() {
  const colorScheme = useColorScheme();

  // One observer for the whole app, same reasoning as the idle timer below. It only buffers —
  // the trail is written as a single document when the session ends — and it is inert until
  // someone is signed in, because `recordScreen` ignores calls with no actor.
  useScreenLog();

  return (
    <AuthProvider>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        {/*
          Inside AuthProvider because it needs `user` and `signOut`; outside the Stack because a
          single timer has to span every screen — one per route would restart on navigation,
          which is the opposite of an inactivity limit.
        */}
        <IdleTimeout>
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="(auth)" />
            {/*
              Deliberately a root route rather than part of (auth): an unverified account *is*
              signed in, so the auth group's "signed in? leave" guard and this screen's own
              redirect would bounce off each other every render. Sitting outside every guarded
              group, it is reachable in exactly the one state that needs it.
            */}
            <Stack.Screen name="verify-email" />
            <Stack.Screen name="(member)" />
            <Stack.Screen name="(admin)" />
            <Stack.Screen name="scan" options={{ presentation: 'modal', headerShown: true, title: 'Scan QR Pass' }} />
          </Stack>
        </IdleTimeout>
      </ThemeProvider>
    </AuthProvider>
  );
}
