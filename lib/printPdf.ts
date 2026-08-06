/**
 * Native counterpart to printPdf.web.ts. There is no print dialog to hand a table to, and no
 * `document` to build one in.
 *
 * A no-op rather than an absent module: the screen imports this unconditionally and gates the
 * button on `Platform.OS === 'web'`, and the same split already governs the payments CSV export.
 * Native printing would mean expo-print plus a bundled HTML pipeline, which is its own task.
 */
export type PrintTable = {
  title: string;
  subtitle?: string;
  headers: string[];
  rows: string[][];
};

export function printTable(_table: PrintTable): void {
  console.warn('[print] PDF export is web-only');
}
