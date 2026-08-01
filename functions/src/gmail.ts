import { google } from 'googleapis';
import { defineSecret, defineString } from 'firebase-functions/params';
import * as logger from 'firebase-functions/logger';

/**
 * Gmail OAuth2 credentials. These live in Secret Manager and are readable only by the
 * functions that declare them — they are never bundled into the mobile app.
 *
 * One-time setup:
 *   1. Google Cloud console → APIs & Services → enable the Gmail API.
 *   2. Create an OAuth 2.0 Client ID of type "Web application".
 *      Add https://developers.google.com/oauthplayground as a redirect URI.
 *   3. In the OAuth Playground, click the gear, tick "Use your own OAuth credentials",
 *      paste the client id/secret, authorize the scope
 *      https://www.googleapis.com/auth/gmail.send, and exchange for a refresh token.
 *   4. firebase functions:secrets:set GMAIL_CLIENT_ID
 *      firebase functions:secrets:set GMAIL_CLIENT_SECRET
 *      firebase functions:secrets:set GMAIL_REFRESH_TOKEN
 *
 * The consenting account is the one the emails are sent from.
 */
export const GMAIL_CLIENT_ID = defineSecret('GMAIL_CLIENT_ID');
export const GMAIL_CLIENT_SECRET = defineSecret('GMAIL_CLIENT_SECRET');
export const GMAIL_REFRESH_TOKEN = defineSecret('GMAIL_REFRESH_TOKEN');

/** Non-secret config, set in .env or via firebase functions:config. */
export const GYM_NAME = defineString('GYM_NAME', { default: 'Hardcore Gym' });
export const GYM_FROM_EMAIL = defineString('GYM_FROM_EMAIL', { default: '' });
export const GYM_REPLY_TO = defineString('GYM_REPLY_TO', { default: '' });

const OAUTH_REDIRECT = 'https://developers.google.com/oauthplayground';

function gmailClient() {
  const oauth2 = new google.auth.OAuth2(
    GMAIL_CLIENT_ID.value(),
    GMAIL_CLIENT_SECRET.value(),
    OAUTH_REDIRECT
  );
  oauth2.setCredentials({ refresh_token: GMAIL_REFRESH_TOKEN.value() });
  return google.gmail({ version: 'v1', auth: oauth2 });
}

/** RFC 2047 encoding so non-ASCII names survive in headers. */
function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  return /^[\x00-\x7F]*$/.test(value)
    ? value
    : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

/** Gmail's API wants base64url with no padding. */
function toBase64Url(input: string): string {
  return Buffer.from(input, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function buildMime(params: {
  to: string;
  from: string;
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
}): string {
  const boundary = `hcg_${Buffer.from(params.to + params.subject).toString('hex').slice(0, 24)}`;

  const headers = [
    `From: ${params.from}`,
    `To: ${params.to}`,
    params.replyTo ? `Reply-To: ${params.replyTo}` : null,
    `Subject: ${encodeHeader(params.subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ].filter(Boolean);

  // Plain-text part first: clients pick the last part they can render, so HTML wins
  // where supported and text is the fallback everywhere else.
  return [
    ...headers,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 7bit',
    '',
    params.text,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: 7bit',
    '',
    params.html,
    '',
    `--${boundary}--`,
  ].join('\r\n');
}

export type SendResult = { messageId: string | null };

export async function sendMail(params: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<SendResult> {
  const gymName = GYM_NAME.value() || 'Hardcore Gym';
  const fromEmail = GYM_FROM_EMAIL.value();
  const replyTo = GYM_REPLY_TO.value() || undefined;

  // 'me' resolves to the authorized account, so a missing GYM_FROM_EMAIL is non-fatal.
  const from = fromEmail ? `${encodeHeader(gymName)} <${fromEmail}>` : encodeHeader(gymName);

  const raw = toBase64Url(
    buildMime({
      to: params.to,
      from,
      replyTo,
      subject: params.subject,
      html: params.html,
      text: params.text,
    })
  );

  const gmail = gmailClient();
  const response = await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw },
  });

  logger.info('gmail.send ok', { to: params.to, id: response.data.id });
  return { messageId: response.data.id ?? null };
}
