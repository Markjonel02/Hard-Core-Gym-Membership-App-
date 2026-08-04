/**
 * Name composition.
 *
 * Accounts store first / middle / last separately, because that is what the front desk needs
 * for ID checks and what a gym roster is sorted by. Everything user-facing still wants one
 * string, so composition happens here rather than being re-derived at each call site.
 */

export type NameParts = {
  firstName: string;
  middleName?: string | null;
  lastName: string;
};

/** `Juan`, `Santos`, `Dela Cruz` -> `Juan Santos Dela Cruz`. Blank middle name just drops out. */
export function composeFullName(parts: NameParts): string {
  return [parts.firstName, parts.middleName, parts.lastName]
    .map((part) => part?.trim() ?? '')
    .filter(Boolean)
    .join(' ');
}

/** Trims each part and normalises an empty middle name to null for a clean Firestore write. */
export function normalizeNameParts(parts: NameParts): Required<NameParts> {
  const middle = parts.middleName?.trim();
  return {
    firstName: parts.firstName.trim(),
    middleName: middle ? middle : null,
    lastName: parts.lastName.trim(),
  };
}

/**
 * Best-effort split for records that predate the split fields (staff-created walk-ins, and
 * any account made before this change). One word becomes the first name; two become first
 * and last; three or more treat everything in the middle as the middle name.
 *
 * This is a display fallback, not a migration — it guesses, and guessing about someone's name
 * is only acceptable when the alternative is showing them nothing.
 */
export function splitFullName(fullName: string): Required<NameParts> {
  const words = fullName.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return { firstName: '', middleName: null, lastName: '' };
  if (words.length === 1) return { firstName: words[0], middleName: null, lastName: '' };
  if (words.length === 2) return { firstName: words[0], middleName: null, lastName: words[1] };
  return {
    firstName: words[0],
    middleName: words.slice(1, -1).join(' '),
    lastName: words[words.length - 1],
  };
}

/** The greeting on the member dashboard. Falls back through the whole chain to "there". */
export function greetingName(candidates: Array<string | null | undefined>): string {
  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (trimmed) return trimmed.split(/\s+/)[0];
  }
  return 'there';
}

/**
 * Display name for a roster row, tolerant of records missing the composed `fullName`.
 *
 * Firestore queries no longer order by `fullName` (a missing key silently excludes the whole
 * document), so rows that never had one now reach the UI instead of disappearing. They need
 * *something* to render: the split parts if present, then the email local part, then a
 * placeholder — never an empty row the front desk can't click.
 */
export function memberDisplayName(record: {
  fullName?: string | null;
  firstName?: string | null;
  middleName?: string | null;
  lastName?: string | null;
  displayName?: string | null;
  email?: string | null;
}): string {
  const full = record.fullName?.trim();
  if (full) return full;

  const composed = composeFullName({
    firstName: record.firstName ?? '',
    middleName: record.middleName ?? null,
    lastName: record.lastName ?? '',
  });
  if (composed) return composed;

  const display = record.displayName?.trim();
  if (display) return display;

  const email = record.email?.trim();
  if (email) return email.split('@')[0];

  return 'Unnamed member';
}

/** Case-insensitive roster sort, replacing the dropped `orderBy('fullName')`. */
export function sortByDisplayName<T extends Parameters<typeof memberDisplayName>[0]>(
  records: T[]
): T[] {
  return [...records].sort((a, b) =>
    memberDisplayName(a).localeCompare(memberDisplayName(b), undefined, { sensitivity: 'base' })
  );
}
