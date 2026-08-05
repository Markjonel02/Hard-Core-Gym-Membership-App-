/**
 * Archiving: the app's stand-in for deletion.
 *
 * Nothing in this app hard-deletes a person. Two reasons, and only the first is a platform
 * limit. The sign-in credential lives in Firebase Auth and `deleteUser` is Admin SDK only, so a
 * client "delete" could remove the Firestore document but never the login — leaving a working
 * credential pointing at nothing, which is worse than either outcome on its own. The second
 * reason survives even on Blaze: payments and check-ins are the source of the revenue figures
 * and the attendance log, and removing the person they point at would silently rewrite last
 * month's totals.
 *
 * So a removed account is flagged, hidden from the default lists, and fully restorable. The flag
 * is absent on every row written before this existed, which is why the predicate tests for an
 * explicit `true` rather than truthiness of a field that may not be there at all.
 */

export type Archivable = { archived?: boolean };

export function isArchived(row: Archivable | null | undefined): boolean {
  return row?.archived === true;
}

/**
 * Splits a list into visible and archived halves in one pass.
 *
 * Returned as both halves rather than a filtered list because every screen that hides archived
 * rows also needs to offer them back — an Archived filter with no data behind it is a dead end,
 * and re-filtering the same array twice at each call site invites the two predicates to drift.
 */
export function partitionArchived<T extends Archivable>(rows: T[]): { active: T[]; archived: T[] } {
  const active: T[] = [];
  const archived: T[] = [];
  for (const row of rows) {
    if (isArchived(row)) archived.push(row);
    else active.push(row);
  }
  return { active, archived };
}
