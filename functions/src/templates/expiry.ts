export type ExpiryHorizon = 90 | 30 | 7;

type TemplateInput = {
  gymName: string;
  memberName: string;
  planName: string;
  expiryDate: string;
  daysRemaining: ExpiryHorizon;
};

/** Escape anything interpolated into the HTML body — names and plans are user-supplied. */
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const HEADLINES: Record<ExpiryHorizon, string> = {
  90: 'Your membership renews in 3 months',
  30: 'Your membership renews in 1 month',
  7: 'Your membership ends in 7 days',
};

const LEADS: Record<ExpiryHorizon, string> = {
  90: 'Just a heads-up so nothing sneaks up on you — there is plenty of time to plan your renewal.',
  30: 'A month to go. Drop by the front desk any time to renew and keep your streak alive.',
  7: 'This is the last reminder before your access pauses. Renew this week to avoid interruption.',
};

export function expirySubject(input: TemplateInput): string {
  const { daysRemaining, gymName } = input;
  if (daysRemaining === 7) return `${gymName}: your membership ends in 7 days`;
  if (daysRemaining === 30) return `${gymName}: 1 month left on your membership`;
  return `${gymName}: 3 months left on your membership`;
}

export function expiryText(input: TemplateInput): string {
  return [
    `Hi ${input.memberName},`,
    '',
    `${HEADLINES[input.daysRemaining]}.`,
    '',
    `Plan: ${input.planName}`,
    `Expires: ${input.expiryDate}`,
    `Days remaining: ${input.daysRemaining}`,
    '',
    LEADS[input.daysRemaining],
    '',
    `See you at the gym,`,
    input.gymName,
  ].join('\n');
}

/**
 * Table-based layout with inline styles — Gmail strips <style> blocks and ignores flexbox,
 * so this is the shape that renders consistently in Gmail web and the Gmail mobile app.
 */
export function expiryHtml(input: TemplateInput): string {
  const name = esc(input.memberName);
  const plan = esc(input.planName);
  const gym = esc(input.gymName);
  const expiry = esc(input.expiryDate);
  const days = input.daysRemaining;
  const accent = days === 7 ? '#c8372d' : days === 30 ? '#b3701a' : '#e8442c';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(HEADLINES[days])}</title>
</head>
<body style="margin:0;padding:0;background-color:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f6f7f9;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e6ec;">
          <tr>
            <td style="background-color:${accent};padding:28px 32px;">
              <div style="color:#ffffff;font-size:13px;letter-spacing:2px;text-transform:uppercase;font-weight:600;">${gym}</div>
              <div style="color:#ffffff;font-size:24px;font-weight:700;margin-top:6px;">${esc(HEADLINES[days])}</div>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              <p style="margin:0 0 16px;font-size:16px;color:#0d1117;">Hi ${name},</p>
              <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#475467;">${esc(LEADS[days])}</p>

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f6f7f9;border-radius:12px;padding:4px 16px;">
                <tr>
                  <td style="padding:12px 0;font-size:14px;color:#667085;">Plan</td>
                  <td style="padding:12px 0;font-size:14px;color:#0d1117;font-weight:600;text-align:right;">${plan}</td>
                </tr>
                <tr>
                  <td style="padding:12px 0;font-size:14px;color:#667085;border-top:1px solid #e2e6ec;">Expires</td>
                  <td style="padding:12px 0;font-size:14px;color:#0d1117;font-weight:600;text-align:right;border-top:1px solid #e2e6ec;">${expiry}</td>
                </tr>
                <tr>
                  <td style="padding:12px 0;font-size:14px;color:#667085;border-top:1px solid #e2e6ec;">Days remaining</td>
                  <td style="padding:12px 0;font-size:14px;color:${accent};font-weight:700;text-align:right;border-top:1px solid #e2e6ec;">${days}</td>
                </tr>
              </table>

              <p style="margin:24px 0 0;font-size:15px;line-height:1.6;color:#475467;">
                Renew at the front desk, or reply to this email and we&rsquo;ll sort it out for you.
              </p>
              <p style="margin:24px 0 0;font-size:15px;color:#0d1117;">See you at the gym,<br><strong>${gym}</strong></p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px;background-color:#f6f7f9;border-top:1px solid #e2e6ec;">
              <p style="margin:0;font-size:12px;line-height:1.5;color:#98a2b3;">
                You&rsquo;re receiving this because you have an active membership at ${gym}.
                Manage reminder preferences in the app under Profile &rsquo; Notifications.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
