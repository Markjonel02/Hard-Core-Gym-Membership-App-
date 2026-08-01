import { Redirect, Stack } from 'expo-router';

import { LoadingScreen } from '@/components/ui/LoadingScreen';
import { useAuth } from '@/context/AuthContext';

/** Signed-in users never see the auth screens — bounce them to their home group. */
export default function AuthLayout() {
  const { user, role, loading } = useAuth();

  if (loading) return <LoadingScreen />;
  if (user) {
    return <Redirect href={role === 'staff' || role === 'admin' ? '/(admin)' : '/(member)'} />;
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}
