import { initializeApp } from 'firebase-admin/app';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { setGlobalOptions } from 'firebase-functions/v2/options';
import * as functionsV1 from 'firebase-functions/v1';
import * as logger from 'firebase-functions/logger';

import { onCheckInWritten, onPaymentWritten } from './aggregates';
import { runExpiryScan, sendManualReminder } from './expiry';
import { GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN } from './gmail';
import {
  enforceRateLimit,
  EXPIRY_SCAN_LIMIT,
  MANUAL_REMINDER_LIMIT,
} from './rateLimit';
import { assignRole, provisionUser } from './roles';

initializeApp();

// Manila is where the gym is; asia-southeast1 keeps Firestore round-trips local.
setGlobalOptions({ region: 'asia-southeast1', maxInstances: 10 });

/** Every function that sends email must declare the secrets, or .value() is empty at runtime. */
const MAIL_SECRETS = [GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN];

// ---------------------------------------------------------------- expiry reminders

/**
 * The requirement: members are emailed 3 months before their membership expires.
 * Runs daily at 09:00 Manila time — the time zone is explicit because a UTC default would
 * both mail at the wrong local hour and shift which members fall inside the day window.
 */
export const dailyExpiryScan = onSchedule(
  {
    schedule: '0 9 * * *',
    timeZone: 'Asia/Manila',
    secrets: MAIL_SECRETS,
    timeoutSeconds: 540,
  },
  async () => {
    const summary = await runExpiryScan();
    logger.info('dailyExpiryScan finished', summary);
  }
);

/** Admin "Run expiry scan now" button — same code path as the scheduler, no waiting a day. */
export const runExpiryScanNow = onCall({ secrets: MAIL_SECRETS }, async (request) => {
  if (request.auth?.token.role !== 'admin') {
    throw new HttpsError('permission-denied', 'Only an admin can run the expiry scan.');
  }
  // After the role check: a rejected caller should not be able to spend an admin's allowance.
  await enforceRateLimit(EXPIRY_SCAN_LIMIT, request.auth.uid);
  return runExpiryScan();
});

/** Staff "Send reminder" button on the member detail screen. */
export const sendExpiryReminder = onCall({ secrets: MAIL_SECRETS }, async (request) => {
  const role = request.auth?.token.role;
  if (role !== 'admin' && role !== 'staff') {
    throw new HttpsError('permission-denied', 'Only staff can send reminders.');
  }

  const memberId = (request.data as { memberId?: string } | undefined)?.memberId;
  if (!memberId) throw new HttpsError('invalid-argument', 'memberId is required.');

  await enforceRateLimit(MANUAL_REMINDER_LIMIT, request.auth!.uid);

  try {
    const { email } = await sendManualReminder(memberId);
    return { ok: true, email };
  } catch (error) {
    logger.error('sendExpiryReminder failed', { memberId, error });
    throw new HttpsError(
      'internal',
      error instanceof Error ? error.message : 'Could not send the reminder.'
    );
  }
});

// ---------------------------------------------------------------- sales aggregation

export const aggregatePayments = onDocumentWritten('payments/{paymentId}', async (event) => {
  await onPaymentWritten(event.data?.before.data(), event.data?.after.data());
});

export const aggregateCheckins = onDocumentWritten('checkins/{checkinId}', async (event) => {
  await onCheckInWritten(event.data?.before.data(), event.data?.after.data());
});

// ---------------------------------------------------------------- accounts and roles

/**
 * v1 auth trigger on purpose: the v2 equivalent (beforeUserCreated) is a blocking function
 * that requires upgrading the project to Identity Platform. This works on plain Firebase Auth.
 */
export const onUserCreated = functionsV1.auth.user().onCreate(async (user) => {
  await provisionUser({
    uid: user.uid,
    email: user.email ?? undefined,
    displayName: user.displayName ?? undefined,
    photoURL: user.photoURL ?? undefined,
  });
});

export const setRole = onCall(async (request) => assignRole(request));
