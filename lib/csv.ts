import { fetchAllPayments } from '@/lib/firestore';
import { formatDate } from '@/lib/format';

/** Quote every field and double internal quotes so names with commas survive Excel. */
function escapeCell(value: unknown): string {
  const raw = value === null || value === undefined ? '' : String(value);
  return `"${raw.replace(/"/g, '""')}"`;
}

export function toCsv(rows: (string | number)[][]): string {
  return rows.map((row) => row.map(escapeCell).join(',')).join('\r\n');
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

  // BOM so Excel detects UTF-8 and renders the ₱ sign correctly.
  const blob = new Blob(['﻿' + toCsv(rows)], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `hardcore-gym-payments-${formatDate(new Date(), 'yyyy-MM-dd')}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
