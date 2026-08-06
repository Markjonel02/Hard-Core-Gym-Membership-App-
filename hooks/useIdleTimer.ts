import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, PanResponder, Platform } from 'react-native';

/** Fifteen minutes of no interaction ends the session. */
export const IDLE_MS = 15 * 60_000;
/** The warning appears one minute before that, at 14:00. */
export const WARN_MS = 60_000;

/**
 * DOM events that count as "the person is still here".
 *
 * `scroll` is captured rather than bubbled: a scroll inside a nested ScrollView does not bubble
 * to `window`, so a listener without capture would treat a user reading a long attendance log as
 * completely idle. `pointerdown` covers mouse and pen; `touchstart` is kept alongside it for
 * browsers that do not synthesise pointer events for touch.
 */
const WEB_EVENTS = ['pointerdown', 'keydown', 'wheel', 'scroll', 'touchstart'] as const;

/** Re-arming the timer on every event of a scroll gesture is wasted work; once a second is plenty. */
const RESCHEDULE_THROTTLE_MS = 1_000;

type IdleTimerOptions = {
  /** Off entirely when false — the sign-in and verify-email screens never arm it. */
  enabled: boolean;
  onWarn: () => void;
  onIdle: () => void;
  /** Fired when interaction actually restarts the countdown, so a visible warning can close. */
  onActivity?: () => void;
  idleMs?: number;
  warnMs?: number;
};

/**
 * Signs the session out after a stretch of no interaction.
 *
 * This has to be a client-side timer: `lib/firebase.ts` sets `browserLocalPersistence` on web and
 * AsyncStorage persistence on native, so a Firebase session outlives the tab, the browser, and the
 * machine being rebooted. Nothing on the server will end it — a front-desk browser left open at a
 * gym counter stays signed in as staff indefinitely otherwise.
 */
export function useIdleTimer({
  enabled,
  onWarn,
  onIdle,
  onActivity,
  idleMs = IDLE_MS,
  warnMs = WARN_MS,
}: IdleTimerOptions) {
  const lastActivity = useRef(Date.now());
  const warnTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastReschedule = useRef(0);

  // One warning and one sign-out per idle window. Without these the catch-up below re-fires both
  // every time it runs: it re-arms from elapsed time, and once elapsed is past the warning point
  // the new timer has a zero delay, so `visibilitychange` firing repeatedly (which browsers and
  // embedded webviews do) produced a stream of duplicate warnings and sign-outs.
  const warned = useRef(false);
  const idled = useRef(false);

  // Held in refs so re-arming does not depend on the caller memoising its callbacks — a parent
  // re-render would otherwise tear down and restart the countdown, silently extending it forever.
  const onWarnRef = useRef(onWarn);
  const onIdleRef = useRef(onIdle);
  const onActivityRef = useRef(onActivity);
  onWarnRef.current = onWarn;
  onIdleRef.current = onIdle;
  onActivityRef.current = onActivity;

  const clear = useCallback(() => {
    if (warnTimer.current) clearTimeout(warnTimer.current);
    if (idleTimer.current) clearTimeout(idleTimer.current);
    warnTimer.current = null;
    idleTimer.current = null;
  }, []);

  const fireWarn = useCallback(() => {
    if (warned.current || idled.current) return;
    warned.current = true;
    onWarnRef.current();
  }, []);

  const fireIdle = useCallback(() => {
    if (idled.current) return;
    idled.current = true;
    onIdleRef.current();
  }, []);

  /** `elapsed` is how much of the window has already gone by — 0 for a fresh start. */
  const schedule = useCallback(
    (elapsed: number) => {
      clear();
      warnTimer.current = setTimeout(fireWarn, Math.max(0, idleMs - warnMs - elapsed));
      idleTimer.current = setTimeout(fireIdle, Math.max(0, idleMs - elapsed));
    },
    [clear, fireWarn, fireIdle, idleMs, warnMs]
  );

  /** Called by interaction listeners and by the "Stay signed in" button. */
  const reset = useCallback(
    (force = false) => {
      const now = Date.now();
      // The timestamp is always recorded, even when the re-arm is throttled away, because the
      // catch-up check reads it — a scroll gesture must move the clock forward even if it does
      // not rebuild the timers.
      lastActivity.current = now;
      if (!force && now - lastReschedule.current < RESCHEDULE_THROTTLE_MS) return;
      lastReschedule.current = now;
      warned.current = false;
      idled.current = false;
      schedule(0);
      onActivityRef.current?.();
    },
    [schedule]
  );

  useEffect(() => {
    if (!enabled) {
      clear();
      return;
    }

    reset(true);

    /**
     * Backgrounded tabs have their timers throttled or suspended outright, so the 15-minute
     * callback can fire minutes late or not at all. Comparing wall-clock time on the way back is
     * what makes "walked away with the tab hidden" actually sign out — a bare setTimeout would
     * hand the next person at the desk a live session.
     */
    const catchUp = () => {
      const elapsed = Date.now() - lastActivity.current;
      if (elapsed >= idleMs) {
        clear();
        fireIdle();
        return;
      }
      // Returning early is not enough: the suspended timers may be stale by minutes, so they are
      // rebuilt from the real elapsed time rather than trusted. If the window passed the warning
      // point while hidden, the rebuilt warn timer fires at once — and `fireWarn` makes that a
      // no-op if the warning is already up.
      schedule(elapsed);
    };

    if (Platform.OS === 'web') {
      const handler = () => reset();
      for (const event of WEB_EVENTS) {
        window.addEventListener(event, handler, { capture: true, passive: true });
      }

      const onVisibility = () => {
        if (document.visibilityState === 'visible') catchUp();
      };
      document.addEventListener('visibilitychange', onVisibility);

      return () => {
        for (const event of WEB_EVENTS) {
          window.removeEventListener(event, handler, { capture: true });
        }
        document.removeEventListener('visibilitychange', onVisibility);
        clear();
      };
    }

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') catchUp();
    });

    return () => {
      sub.remove();
      clear();
    };
  }, [enabled, reset, clear, schedule, fireIdle, idleMs]);

  return { reset };
}

/**
 * Touch observer for native.
 *
 * `onStartShouldSetPanResponderCapture` returns false on purpose: it sees every touch on its way
 * down the tree and then declines to become the responder, so buttons underneath still work
 * normally. Spread onto a root View; on web it is unused, since DOM events cover it.
 */
export function useIdlePanHandlers(onTouch: () => void) {
  const onTouchRef = useRef(onTouch);
  onTouchRef.current = onTouch;

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponderCapture: () => {
        onTouchRef.current();
        return false;
      },
      onMoveShouldSetPanResponderCapture: () => {
        onTouchRef.current();
        return false;
      },
    })
  ).current;

  return Platform.OS === 'web' ? {} : responder.panHandlers;
}

/** Seconds left, for the warning countdown. */
export function useCountdown(active: boolean, seconds: number) {
  const [left, setLeft] = useState(seconds);

  useEffect(() => {
    if (!active) {
      setLeft(seconds);
      return;
    }
    setLeft(seconds);
    const id = setInterval(() => setLeft((n) => Math.max(0, n - 1)), 1_000);
    return () => clearInterval(id);
  }, [active, seconds]);

  return left;
}
