import { useCallback, useState, type PropsWithChildren } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { useThemeColor } from '@/components/Themed';
import { useAuth } from '@/context/AuthContext';
import { FontSize, FontWeight, Radius, Shadow, Spacing } from '@/constants/Theme';
import { IDLE_MS, WARN_MS, useCountdown, useIdlePanHandlers, useIdleTimer } from '@/hooks/useIdleTimer';

/**
 * Signs an idle session out, with a countdown first.
 *
 * Wraps the navigator rather than sitting beside it: on native the touch observer is a
 * `PanResponder` in the *capture* phase, which only sees touches that pass through this view on
 * their way down. A sibling overlay would have to swallow them to see them.
 *
 * Mounted once inside `AuthProvider` so a single timer covers every screen — per-screen timers
 * would each restart on navigation, which is the opposite of what an inactivity limit means.
 *
 * A `Modal` for the warning, following `OverflowMenu`: it is the only thing that reliably draws
 * above the Expo Router header on web and Android, and this in particular must not be coverable
 * by whatever screen is underneath.
 */
export function IdleTimeout({ children }: PropsWithChildren) {
  const { user, signOut } = useAuth();
  const [warning, setWarning] = useState(false);

  const dismissAndSignOut = useCallback(() => {
    setWarning(false);
    // The context `signOut`, never `fbSignOut` — it detaches the profile and membership
    // listeners first. Signing out from under two live `onSnapshot` calls produces a burst of
    // permission-denied errors as the rules stop matching a token that no longer exists.
    void signOut('idle');
  }, [signOut]);

  // Gated on `user`: the sign-in and verify-email screens must never arm this. It also keeps the
  // 5-second verification poll on that screen from being mistaken for a person being present.
  const { reset } = useIdleTimer({
    enabled: !!user,
    onWarn: () => setWarning(true),
    onIdle: dismissAndSignOut,
    // Any interaction restarts the countdown, so the warning has to close with it. Without this
    // the sheet would sit there counting down to a sign-out that is no longer coming, and the
    // only way past it would be the button.
    onActivity: () => setWarning(false),
  });

  const staySignedIn = useCallback(() => {
    setWarning(false);
    // Forced past the throttle: this is the one reset that must rebuild the timers immediately,
    // since the previous ones are seconds from firing.
    reset(true);
  }, [reset]);

  const panHandlers = useIdlePanHandlers(reset);

  const secondsLeft = useCountdown(warning, Math.round(WARN_MS / 1000));
  const minutes = Math.round(IDLE_MS / 60_000);

  const text = useThemeColor({}, 'text');
  const muted = useThemeColor({}, 'muted');
  const card = useThemeColor({}, 'card');
  const border = useThemeColor({}, 'border');

  if (!user) return <>{children}</>;

  return (
    // On native, `panHandlers` observes every touch on its way down without stealing it; on web
    // it is empty and the DOM listeners inside the hook do the same job.
    <View style={styles.fill} {...panHandlers}>
      {children}
      <Modal visible={warning} transparent animationType="fade" onRequestClose={staySignedIn}>
        <View style={styles.backdrop}>
          <View
            style={[styles.sheet, Shadow.card, { backgroundColor: card, borderColor: border }]}>
            <Text style={[styles.title, { color: text }]}>Still there?</Text>
            <Text style={{ color: muted }}>
              You have been inactive, so this session will end in {secondsLeft} second
              {secondsLeft === 1 ? '' : 's'}. Sessions close after {minutes} minutes of inactivity
              so a signed-in account is not left open at the front desk.
            </Text>
            <Button title="Stay signed in" onPress={staySignedIn} />
            <Button title="Sign out now" variant="ghost" onPress={dismissAndSignOut} />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.lg,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  sheet: {
    width: '100%',
    maxWidth: 380,
    gap: Spacing.md,
    padding: Spacing.xl,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: FontSize.xl, fontWeight: FontWeight.bold },
});
