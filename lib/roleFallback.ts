/**
 * The terminal fallback for role changes, used wherever the `setRole` callable is offered.
 *
 * In-app role assignment goes through a Cloud Function, because setting a custom claim needs the
 * Admin SDK and no client may do it. Functions v2 builds through Cloud Build, which requires the
 * Blaze plan, so on Spark that callable does not exist — it answers 404, the browser reports the
 * missing CORS header rather than the missing function, and the admin is left with an error that
 * names a fix they cannot perform.
 *
 * `functions/scripts/make-admin.js` does exactly the same work over the Admin SDK and needs no
 * deployment at all. Surfacing its command is therefore not a workaround for a broken feature; it
 * is the supported path on this plan. The callable is still attempted first everywhere, so these
 * fallbacks disappear on their own if the project is ever upgraded.
 */
import type { Role } from '@/types/models';

/**
 * The exact line to paste, run from the `functions/` directory.
 *
 * `member` is expressed as `--role=member` rather than omitted: the script defaults to admin
 * when no role is given, so a demotion written the short way would silently promote instead.
 */
export function makeAdminCommand(email: string, role: Role): string {
  return `node scripts/make-admin.js ${email.trim()} --role=${role}`;
}

export function makeAdminCommands(entries: { email: string; role: Role }[]): string {
  return entries.map((entry) => makeAdminCommand(entry.email, entry.role)).join('\n');
}

/** Shown above the command block, so the reason is attached to the instruction. */
export const MAKE_ADMIN_HINT =
  'In-app role changes need Cloud Functions, which need the Blaze plan. Until then, run this from the `functions/` folder — it does the same thing:';

/**
 * The step that is genuinely easy to miss. A custom claim only reaches a client on its next
 * token, so an admin who runs the command and watches the app sees nothing change and reasonably
 * concludes it failed. The script revokes refresh tokens to force that refresh, but the session
 * already open on the device still has to be restarted.
 */
export const MAKE_ADMIN_AFTER =
  'They need to sign out and back in for the new role to take effect.';
