import { fetchAllPayments } from '@/lib/firestore';
import { formatDate, formatDateTime } from '@/lib/format';
import type { SecurityLog } from '@/types/models';

/** Quote every field and double internal quotes so names with commas survive Excel. */
function escapeCell(value: unknown): string {
  const raw = value === null || value === undefined ? '' : String(value);
  return `"${raw.replace(/"/g, '""')}"`;
}

export function toCsv(rows: (string | number)[][]): string {
  return rows.map((row) => row.map(escapeCell).join(',')).join('\r\n');
}

/**
 * Hands a CSV string to the browser as a file.
 *
 * The BOM is not optional: without it Excel reads the bytes as its local codepage and every ₱
 * in an amount or a log detail arrives as mojibake.
 */
function downloadCsv(rows: (string | number)[][], filename: string) {
  const blob = new Blob(['﻿' + toCsv(rows)], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Web-only export. Native would need expo-file-system + expo-sharing; the admin
 * dashboard hides the button off web.
 */
export async function exportPaymentsCsv() {
  const payments = await fetchAllPayments();

  const rows: (string | number)[][] = [
    ['Paid at', 'Member', 'Plan', 'Type', 'Method', 'Amount', 'Period start', 'Period end'],
    ...payments.map((p) => [
      formatDate(p.paidAt, 'yyyy-MM-dd'),
      p.memberName ?? '',
      p.planName ?? '',
      p.kind ?? '',
      p.method ?? '',
      (p.amountCents ?? 0) / 100,
      formatDate(p.periodStart, 'yyyy-MM-dd'),
      formatDate(p.periodEnd, 'yyyy-MM-dd'),
    ]),
  ];

  downloadCsv(rows, `hardcore-gym-payments-${formatDate(new Date(), 'yyyy-MM-dd')}.csv`);
}

/** The columns of a security-log report, in order. Shared so CSV and PDF cannot drift apart. */
export const SECURITY_LOG_HEADERS = [
  'When',
  'Type',
  'Who',
  'Role',
  'Action',
  'Detail',
  'Reason',
  'Screens',
];

/**
 * Flattens log documents into report rows.
 *
 * The screen trail becomes `Home > Membership > Check-in` — a spreadsheet cell cannot hold an
 * array, and the order is the only thing about it that carries meaning. Timestamps inside the
 * trail are dropped here on purpose: the row already carries when the session ended, and eight
 * columns of times inside one cell is not something anyone reads.
 */
export function securityLogRows(logs: SecurityLog[]): string[][] {
  return logs.map((log) => [
    formatDateTime(log.at),
    log.type,
    log.who ?? '',
    log.role ?? '',
    log.action ?? '',
    log.detail ?? '',
    log.reason ?? '',
    (log.screens ?? []).map((s) => s.name).join(' > '),
  ]);
}

/** Web-only, and exports the rows the admin is looking at — the filters are the report. */
export function exportSecurityLogsCsv(logs: SecurityLog[]) {
  downloadCsv(
    [SECURITY_LOG_HEADERS, ...securityLogRows(logs)],
    `hardcore-gym-security-logs-${formatDate(new Date(), 'yyyy-MM-dd')}.csv`
  );
}
