/**
 * Prints a table through the browser's own print dialog, where "Save as PDF" is a destination.
 *
 * Deliberately not a PDF writer. A hand-rolled one would be a few hundred lines of byte layout to
 * reimplement pagination and font metrics badly, and a library like jsPDF is a dependency carried
 * by every user of the app for a button an admin presses occasionally. The browser already has a
 * correct, accessible renderer: this hands it clean HTML and gets a real PDF with selectable text.
 *
 * Web-only — `printPdf.ts` is the native no-op. The screen hides the button off web, same as the
 * payments CSV export.
 */

/** Escapes text for HTML. The log carries member-supplied names; none of it may become markup. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function tableHtml(headers: string[], rows: string[][]): string {
  const head = headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('');
  const body = rows
    .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`)
    .join('');
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

/**
 * `thead { display: table-header-group }` is what repeats the column headers on every printed
 * page; without it page two onwards is an unlabelled grid. Landscape because eight columns do not
 * fit across a portrait page at a readable size.
 */
const PRINT_CSS = `
  @page { size: landscape; margin: 14mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; color: #111; margin: 0; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .meta { font-size: 11px; color: #555; margin-bottom: 12px; }
  table { width: 100%; border-collapse: collapse; font-size: 10px; }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; }
  th, td { border: 1px solid #d0d0d0; padding: 4px 6px; text-align: left; vertical-align: top; }
  th { background: #f2f2f2; font-weight: 600; }
  td { word-break: break-word; }
`;

export type PrintTable = {
  title: string;
  /** Shown under the title — the window and filters the rows were taken from. */
  subtitle?: string;
  headers: string[];
  rows: string[][];
};

/**
 * Renders the table into a hidden same-origin iframe and opens the print dialog on it.
 *
 * An iframe rather than `window.open`: a popup is blocked unless the click is trusted all the way
 * down, and printing the app's own document would drag the entire React tree and its stylesheets
 * into the output. The iframe is a blank page containing only this table.
 *
 * Cleanup is on `afterprint` rather than immediately after `print()` — the dialog is modal in some
 * browsers and non-blocking in others, and removing the frame while it is still the print source
 * yields a blank sheet. The timeout is the backstop for browsers that never fire the event.
 */
export function printTable({ title, subtitle, headers, rows }: PrintTable): void {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(frame);

  const doc = frame.contentDocument;
  const win = frame.contentWindow;
  if (!doc || !win) {
    document.body.removeChild(frame);
    console.warn('[print] could not open a print frame');
    return;
  }

  doc.open();
  doc.write(
    `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>` +
      `<style>${PRINT_CSS}</style></head><body>` +
      `<h1>${escapeHtml(title)}</h1>` +
      (subtitle ? `<div class="meta">${escapeHtml(subtitle)}</div>` : '') +
      tableHtml(headers, rows) +
      `</body></html>`
  );
  doc.close();

  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    // Guarded: `afterprint` and the timeout can both arrive, and on a fast dialog the frame may
    // already be detached by the time the second one runs.
    if (frame.parentNode) document.body.removeChild(frame);
  };

  win.addEventListener('afterprint', cleanup);
  win.focus();
  win.print();
  setTimeout(cleanup, 60_000);
}
