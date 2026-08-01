/**
 * Per-caller rate limiting for callable functions.
 *
 * The callables here are already role-gated, so this is not an authorization boundary — it is
 * a guardrail against the expensive accidents that role checks do not catch: a retry loop on
 * a flaky connection, a double-tapped "Send reminder", or a script hammering the expiry scan.
 * Each of those spends Gmail quota and function time, so the ceiling has to live server-side.
 *
 * State is kept in Firestore rather than in memory because Cloud Functions scales to many
 * instances: an in-memory counter would let the effective limit multiply by the instance count.
 * A transaction makes the read-modify-write atomic, so two concurrent calls cannot both see a
 * count of `limit - 1` and both proceed.
 */
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';

export type RateLimitRule = {
  /** Short slug; becomes part of the document id, so keep it free of slashes. */
  name: string;
  /** Calls permitted inside the window. */
  limit: number;
  /** Window length in seconds. */
  windowSeconds: number;
};

/**
 * Running the scan twice in a row achieves nothing — the notifications collection dedupes the
 * sends — but it still walks every active member and burns the time budget.
 */
export const EXPIRY_SCAN_LIMIT: RateLimitRule = {
  name: 'expiry-scan',
  limit: 3,
  windowSeconds: 60 * 60,
};

/** One email per call. Staff clearing a backlog legitimately send a run of these. */
export const MANUAL_REMINDER_LIMIT: RateLimitRule = {
  name: 'manual-reminder',
  limit: 20,
  windowSeconds: 60 * 60,
};

/** Each call revokes the target's refresh tokens, forcing them to sign in again. */
export const SET_ROLE_LIMIT: RateLimitRule = {
  name: 'set-role',
  limit: 10,
  windowSeconds: 60 * 60,
};

/**
 * Sliding window log: the document holds one timestamp per call still inside the window.
 *
 * A fixed-window counter is cheaper but lets a caller spend the whole allowance at the end of
 * one window and again at the start of the next — a 2x burst. These limits are small enough
 * (tens, not thousands) that storing the individual timestamps costs nothing and removes that
 * edge entirely.
 *
 * Throws `resource-exhausted`, which the Functions SDK surfaces to the client as HTTP 429.
 */
export async function enforceRateLimit(rule: RateLimitRule, callerId: string): Promise<void> {
  const db = getFirestore();
  const ref = db.doc(`rateLimits/${rule.name}_${callerId}`);
  const now = Date.now();
  const windowMs = rule.windowSeconds * 1000;
  const windowStart = now - windowMs;

  const retryAfterSeconds = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const recorded = (snap.get('hits') as Timestamp[] | undefined) ?? [];

    // Anything older than the window is irrelevant and is dropped on write, which is what
    // keeps the array bounded at `limit` entries instead of growing forever.
    const hits = recorded.map((t) => t.toMillis()).filter((ms) => ms > windowStart);

    if (hits.length >= rule.limit) {
      const oldest = Math.min(...hits);
      // The allowance frees up when the oldest hit falls out of the window.
      return Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
    }

    hits.push(now);
    tx.set(ref, {
      hits: hits.map((ms) => Timestamp.fromMillis(ms)),
      updatedAt: Timestamp.fromMillis(now),
      // For a Firestore TTL policy on `expiresAt`, so abandoned counters are reaped instead of
      // accumulating one document per caller forever. Configure it once:
      // Firestore console -> TTL -> collection `rateLimits`, field `expiresAt`.
      expiresAt: Timestamp.fromMillis(now + windowMs),
    });
    return 0;
  });

  if (retryAfterSeconds > 0) {
    logger.warn('rate limit hit', { rule: rule.name, callerId, retryAfterSeconds });
    throw new HttpsError(
      'resource-exhausted',
      `Too many requests. Try again in ${retryAfterSeconds} second${retryAfterSeconds === 1 ? '' : 's'}.`,
      { retryAfterSeconds }
    );
  }
}
