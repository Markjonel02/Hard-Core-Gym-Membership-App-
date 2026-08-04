import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';
import { Redirect, router } from 'expo-router';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { LoadingScreen } from '@/components/ui/LoadingScreen';
import { useThemeColor } from '@/components/Themed';
import { useAuth } from '@/context/AuthContext';
import { FontSize, FontWeight, Spacing } from '@/constants/Theme';
import { authErrorMessage } from '@/lib/authErrors';

/** Firebase rejects rapid resends with auth/too-many-requests; this keeps us under that. */
const RESEND_COOLDOWN_SECONDS = 60;

/**
 * Confirmation gate. A new account lands here instead of the dashboard, and stays until
 * Firebase reports the address as verified.
 *
 * Verification happens in the user's mail client, not in the app, so there is no callback to
 * wait on — `emailVerified` only changes locally after `user.reload()`. This screen therefore
 * polls, refreshes when the app returns to the foreground (the moment they come back from
 * their inbox), and offers a manual button for when neither of those has fired yet.
 */
export default function VerifyEmail() {
  const { user, emailVerified, loading, reloadUser, resendVerificationEmail, signOut } = useAuth();

  const background = useThemeColor({}, 'background');
  const text = useThemeColor({}, 'text');
  const muted = useThemeColor({}, 'muted');
  const brand = useThemeColor({}, 'brand');
  const success = useThemeColor({}, 'success');
  const danger = useThemeColor({}, 'danger');

  const [checking, setChecking] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_SECONDS);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Guards against a second navigation when the poll and the button both resolve. */
  const navigated = useRef(false);

  // Only used by the poll and the button, which fire outside render. The verified and
  // signed-out cases below are handled with <Redirect>, not by navigating from an effect.
  const goToApp = useCallback(() => {
    if (navigated.current) return;
    navigated.current = true;
    router.replace('/');
  }, []);

  const check = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!options?.silent) {
        setChecking(true);
        setError(null);
        setNotice(null);
      }
      try {
        const verified = await reloadUser();
        if (verified) {
          goToApp();
        } else if (!options?.silent) {
          setNotice('Not confirmed yet. Open the link in your inbox, then check again.');
        }
      } catch (err) {
        if (!options?.silent) setError(authErrorMessage(err));
      } finally {
        if (!options?.silent) setChecking(false);
      }
    },
    [goToApp, reloadUser]
  );

  // Background poll. Five seconds is frequent enough that the app has usually caught up by
  // the time they switch back, and light enough to leave running.
  useEffect(() => {
    const id = setInterval(() => void check({ silent: true }), 5000);
    return () => clearInterval(id);
  }, [check]);

  // The common path on mobile: leave for the mail app, tap the link, come back.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void check({ silent: true });
    });
    return () => sub.remove();
  }, [check]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((n) => n - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  const resend = useCallback(async () => {
    setResending(true);
    setError(null);
    setNotice(null);
    try {
      await resendVerificationEmail();
      setNotice('Sent. Check your inbox — and your spam folder.');
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setResending(false);
    }
  }, [resendVerificationEmail]);

  const useAnotherAccount = useCallback(async () => {
    // Signing out flips the guard below to the sign-in redirect, so no navigation is needed.
    await signOut();
  }, [signOut]);

  // This screen sits outside every route group, so it owns its own entry conditions.
  if (loading) return <LoadingScreen />;
  // Nothing to confirm — either they signed out from here, or they arrived by URL.
  if (!user) return <Redirect href="/(auth)/sign-in" />;
  // Already confirmed: index re-routes them by role.
  if (emailVerified) return <Redirect href="/" />;

  return (
    <View style={[styles.container, { backgroundColor: background }]}>
      <View style={styles.center}>
        <Text style={[styles.icon, { color: brand }]}>✉︎</Text>
        <Text style={[styles.title, { color: text }]}>Confirm your email</Text>
        <Text style={[styles.subtitle, { color: muted }]}>
          We sent a confirmation link to
        </Text>
        <Text style={[styles.email, { color: text }]}>{user?.email ?? 'your email address'}</Text>

        <Card style={styles.card}>
          <Text style={[styles.body, { color: muted }]}>
            Open that link to activate your account. This screen updates on its own once you
            do — you can leave it open.
          </Text>

          {notice ? <Text style={[styles.notice, { color: success }]}>{notice}</Text> : null}
          {error ? <Text style={[styles.notice, { color: danger }]}>{error}</Text> : null}

          <Button title="I've confirmed — continue" loading={checking} onPress={() => void check()} />

          <Button
            title={cooldown > 0 ? `Resend email (${cooldown}s)` : 'Resend email'}
            variant="secondary"
            disabled={cooldown > 0 || resending}
            loading={resending}
            onPress={() => void resend()}
          />
        </Card>

        <Text
          onPress={() => void useAnotherAccount()}
          style={[styles.link, { color: muted }]}
          accessibilityRole="button">
          Use a different account
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: {
    flex: 1,
    justifyContent: 'center',
    padding: Spacing.lg,
    gap: Spacing.sm,
    width: '100%',
    maxWidth: 460,
    alignSelf: 'center',
  },
  icon: { fontSize: 48, textAlign: 'center' },
  title: { fontSize: FontSize.xxl, fontWeight: FontWeight.bold, textAlign: 'center' },
  subtitle: { fontSize: FontSize.md, textAlign: 'center' },
  email: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold,
    textAlign: 'center',
    marginBottom: Spacing.md,
  },
  card: { gap: Spacing.lg },
  body: { fontSize: FontSize.sm, lineHeight: 20 },
  notice: { fontSize: FontSize.sm },
  link: {
    fontSize: FontSize.sm,
    textAlign: 'center',
    marginTop: Spacing.lg,
    textDecorationLine: 'underline',
  },
});
