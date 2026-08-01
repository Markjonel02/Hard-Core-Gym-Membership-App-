import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';

import { GYM_NAME, sendMail } from './gmail';
import { expiryHtml, expirySubject, expiryText, type ExpiryHorizon } from './templates/expiry';

/** 90 days ≈ the "3 months before expiry" reminder the gym asked for, plus two follow-ups. */
export const HORIZONS: ExpiryHorizon[] = [90, 30, 7];

type MemberDoc = {
  fullName?: string;
  email?: string;
  planName?: string;
  status?: string;
  endDate?: Timestamp;
  emailOptIn?: boolean;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Compare whole days in UTC so the count doesn't wobble with time-of-day. */
export function daysBetweenUtc(from: Date, to: Date): number {
  const a = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const b = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.round((b - a) / DAY_MS);
}

function formatExpiry(date: Date): string {
  return date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'Asia/Manila',
  });
}

export type ScanSummary = { scanned: number; sent: number; skipped: number; expired: number };

/**
 * Sends at most one reminder per member per horizon, then flips lapsed memberships to
 * 'expired'. Idempotent: the notifications/{memberId}_{horizon} doc id is created with
 * `create()`, so a retry or a manual re-run can never double-email.
 */
export async function runExpiryScan(): Promise<ScanSummary> {
  const db = getFirestore();
  const now = new Date();
  const gymName = GYM_NAME.value() || 'Hardcore Gym';

  const summary: ScanSummary = { scanned: 0, sent: 0, skipped: 0, expired: 0 };

  // Only look as far ahead as the widest horizon; anything further out isn't due yet.
  const windowEnd = Timestamp.fromDate(new Date(now.getTime() + 91 * DAY_MS));
  const snapshot = await db
    .collection('members')
    .where('status', '==', 'active')
    .where('endDate', '<=', windowEnd)
    .get();

  summary.scanned = snapshot.size;

  for (const doc of snapshot.docs) {
    const member = doc.data() as MemberDoc;
    const endDate = member.endDate?.toDate();
    if (!endDate) {
      summary.skipped++;
      continue;
    }

    const daysRemaining = daysBetweenUtc(now, endDate);

    if (daysRemaining < 0) {
      await doc.ref.update({ status: 'expired', expiredAt: Timestamp.fromDate(now) });
      summary.expired++;
      continue;
    }

    const horizon = HORIZONS.find((h) => h === daysRemaining);
    if (!horizon) {
      summary.skipped++;
      continue;
    }

    if (!member.email || member.emailOptIn === false) {
      summary.skipped++;
      continue;
    }

    const sent = await sendReminderOnce({
      memberId: doc.id,
      email: member.email,
      memberName: member.fullName ?? 'there',
      planName: member.planName ?? 'Membership',
      endDate,
      horizon,
      gymName,
    });

    if (sent) summary.sent++;
    else summary.skipped++;
  }

  logger.info('expiry scan complete', summary);
  return summary;
}

/**
 * Staff-triggered re-send from the member detail screen. Deliberately bypasses the dedupe
 * ledger — the whole point is to send again when a member says they never got the first one.
 * The horizon used is whichever reminder the member is closest to.
 */
export async function sendManualReminder(memberId: string): Promise<{ email: string }> {
  const db = getFirestore();
  const snap = await db.doc(`members/${memberId}`).get();
  if (!snap.exists) throw new Error('Member not found.');

  const member = snap.data() as MemberDoc;
  if (!member.email) throw new Error('This member has no email address on file.');

  const endDate = member.endDate?.toDate();
  if (!endDate) throw new Error('This member has no expiry date set.');

  const daysRemaining = Math.max(daysBetweenUtc(new Date(), endDate), 0);
  const horizon =
    HORIZONS.find((h) => daysRemaining <= h) ?? HORIZONS[HORIZONS.length - 1];

  const templateInput = {
    gymName: GYM_NAME.value() || 'Hardcore Gym',
    memberName: member.fullName ?? 'there',
    planName: member.planName ?? 'Membership',
    expiryDate: formatExpiry(endDate),
    daysRemaining: horizon,
  };

  const result = await sendMail({
    to: member.email,
    subject: expirySubject(templateInput),
    html: expiryHtml(templateInput),
    text: expiryText(templateInput),
  });

  await db.collection('notifications').add({
    memberId,
    horizon,
    email: member.email,
    channel: 'gmail',
    status: 'sent',
    manual: true,
    messageId: result.messageId,
    sentAt: Timestamp.now(),
    createdAt: Timestamp.now(),
  });

  return { email: member.email };
}

/** Returns false when this member+horizon was already emailed. */
export async function sendReminderOnce(params: {
  memberId: string;
  email: string;
  memberName: string;
  planName: string;
  endDate: Date;
  horizon: ExpiryHorizon;
  gymName: string;
}): Promise<boolean> {
  const db = getFirestore();
  const ledgerRef = db.collection('notifications').doc(`${params.memberId}_${params.horizon}`);

  // Claim the send first. If the doc already exists, create() throws ALREADY_EXISTS (code 6)
  // and we skip — this is the dedupe guard, so it must happen before the network call.
  try {
    await ledgerRef.create({
      memberId: params.memberId,
      horizon: params.horizon,
      email: params.email,
      channel: 'gmail',
      status: 'sending',
      createdAt: Timestamp.now(),
    });
  } catch (error) {
    const code = (error as { code?: number }).code;
    if (code === 6) {
      logger.debug('reminder already sent, skipping', {
        memberId: params.memberId,
        horizon: params.horizon,
      });
      return false;
    }
    throw error;
  }

  const templateInput = {
    gymName: params.gymName,
    memberName: params.memberName,
    planName: params.planName,
    expiryDate: formatExpiry(params.endDate),
    daysRemaining: params.horizon,
  };

  try {
    const result = await sendMail({
      to: params.email,
      subject: expirySubject(templateInput),
      html: expiryHtml(templateInput),
      text: expiryText(templateInput),
    });
    await ledgerRef.update({
      status: 'sent',
      messageId: result.messageId,
      sentAt: Timestamp.now(),
    });
    return true;
  } catch (error) {
    // Record the failure but keep the doc so a bad address doesn't retry forever;
    // staff can re-send manually from the member detail screen.
    await ledgerRef.update({
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
      failedAt: Timestamp.now(),
    });
    logger.error('reminder send failed', {
      memberId: params.memberId,
      horizon: params.horizon,
      error,
    });
    throw error;
  }
}
