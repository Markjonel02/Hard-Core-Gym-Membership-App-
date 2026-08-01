import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';

/**
 * Firestore has no GROUP BY, so the sales dashboard reads pre-summed counters instead of
 * downloading every payment. These triggers keep those counters in step with the raw docs.
 *
 * Deltas are signed: a create adds, a delete subtracts, and an edit applies the difference.
 * That keeps the totals correct if staff fix a mistyped amount rather than only ever appending.
 */

const TZ = 'Asia/Manila';

/** Bucket ids are local-date strings so a 9pm payment lands on the day the gym counts it. */
export function bucketIds(date: Date): { day: string; month: string } {
  // en-CA gives YYYY-MM-DD, which sorts lexically and matches the doc-id scheme.
  const day = date.toLocaleDateString('en-CA', { timeZone: TZ });
  return { day, month: day.slice(0, 7) };
}

type PaymentDoc = {
  amountCents?: number;
  kind?: 'new' | 'renewal';
  paidAt?: Timestamp;
};

type CheckInDoc = { at?: Timestamp };

/** Merge-writes the delta onto both buckets. Increment is commutative, so no transaction needed. */
async function applyDelta(date: Date, delta: Record<string, number>) {
  const nonZero = Object.entries(delta).filter(([, v]) => v !== 0);
  if (nonZero.length === 0) return;

  const db = getFirestore();
  const { day, month } = bucketIds(date);
  const increments = Object.fromEntries(nonZero.map(([k, v]) => [k, FieldValue.increment(v)]));

  await Promise.all([
    db
      .doc(`stats/daily/entries/${day}`)
      .set({ ...increments, date: day, updatedAt: FieldValue.serverTimestamp() }, { merge: true }),
    db
      .doc(`stats/monthly/entries/${month}`)
      .set(
        { ...increments, month, updatedAt: FieldValue.serverTimestamp() },
        { merge: true }
      ),
  ]);
}

function paymentDelta(payment: PaymentDoc, sign: 1 | -1): Record<string, number> {
  const amount = (payment.amountCents ?? 0) * sign;
  return {
    revenueCents: amount,
    newMembers: payment.kind === 'new' ? sign : 0,
    renewals: payment.kind === 'renewal' ? sign : 0,
  };
}

/** `before`/`after` come straight from the onDocumentWritten event snapshots. */
export async function onPaymentWritten(
  before: PaymentDoc | undefined,
  after: PaymentDoc | undefined
) {
  const beforeDate = before?.paidAt?.toDate();
  const afterDate = after?.paidAt?.toDate();

  // A paidAt edit can move the payment between buckets, so back it out of the old one first.
  const sameBucket =
    beforeDate &&
    afterDate &&
    bucketIds(beforeDate).day === bucketIds(afterDate).day;

  if (before && beforeDate && !sameBucket) {
    await applyDelta(beforeDate, paymentDelta(before, -1));
  }
  if (after && afterDate) {
    const base = paymentDelta(after, 1);
    const delta =
      sameBucket && before
        ? mergeDeltas(base, paymentDelta(before, -1))
        : base;
    await applyDelta(afterDate, delta);
  }

  logger.debug('payment aggregate applied', { hadBefore: !!before, hasAfter: !!after });
}

export async function onCheckInWritten(
  before: CheckInDoc | undefined,
  after: CheckInDoc | undefined
) {
  // Check-ins are append-only in practice; only the create and delete edges matter.
  if (!before && after?.at) {
    await applyDelta(after.at.toDate(), { checkins: 1 });
  } else if (before?.at && !after) {
    await applyDelta(before.at.toDate(), { checkins: -1 });
  }
}

function mergeDeltas(
  a: Record<string, number>,
  b: Record<string, number>
): Record<string, number> {
  const out: Record<string, number> = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = (out[k] ?? 0) + v;
  return out;
}
