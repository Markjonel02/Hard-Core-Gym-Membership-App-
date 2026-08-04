import { Redirect, Stack } from 'expo-router';

import { LoadingScreen } from '@/components/ui/LoadingScreen';
import { useAuth } from '@/context/AuthContext';

/**
 * Signed-in users never see the auth screens — bounce them out to where they belong.
 *
 * An account that exists but has not confirmed its address counts as signed in, so it is sent
 * to the verification gate rather than the dashboard. That screen lives at the root, outside
 * this group, precisely so this rule can stay unconditional: keeping it inside meant adding a
 * pathname exception here, and that exception raced this redirect into an infinite loop.
 */
export default function AuthLayout() {
  const { user, role, loading, emailVerified } = useAuth();

  if (loading) return <LoadingScreen />;

  if (user) {
    if (!emailVerified) return <Redirect href="/verify-email" />;
    return <Redirect href={role === 'staff' || role === 'admin' ? '/(admin)' : '/(member)'} />;
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}
