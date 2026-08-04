import { Redirect } from 'expo-router';

import { useAuth } from '@/context/AuthContext';
import { LoadingScreen } from '@/components/ui/LoadingScreen';

/**
 * Entry route. Sends each visitor to the right group once auth resolves:
 * signed out → sign-in, staff/admin → admin dashboard, member → member dashboard.
 */
export default function Index() {
  const { user, role, loading, emailVerified } = useAuth();

  if (loading) return <LoadingScreen />;
  if (!user) return <Redirect href="/(auth)/sign-in" />;
  // Unconfirmed accounts get no further than the gate, whatever their role.
  if (!emailVerified) return <Redirect href="/verify-email" />;
  if (role === 'staff' || role === 'admin') return <Redirect href="/(admin)" />;
  return <Redirect href="/(member)" />;
}


