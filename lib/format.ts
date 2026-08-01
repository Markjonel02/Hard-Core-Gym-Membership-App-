import { differenceInCalendarDays, format } from 'date-fns';
import type { Timestamp } from 'firebase/firestore';

import type { BadgeTone } from '@/components/ui/Badge';
import type { MemberStatus } from '@/types/models';

/** Money is stored as integer cents everywhere to avoid float drift. */
export function formatCurrency(cents: number, currency = 'PHP'): string {
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format((cents ?? 0) / 100);
}

export function formatCompactCurrency(cents: number, symbol = '₱'): string {
  const value = (cents ?? 0) / 100;
  if (Math.abs(value) >= 1_000_000) return `${symbol}${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${symbol}${(value / 1_000).toFixed(1)}k`;
  return `${symbol}${Math.round(value)}`;
}

/** Firestore Timestamps arrive as null while a serverTimestamp() write is pending. */
export function toDate(value: Timestamp | Date | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof (value as Timestamp).toDate === 'function') return (value as Timestamp).toDate();
  return null;
}

export function formatDate(value: Timestamp | Date | null | undefined, pattern = 'MMM d, yyyy') {
  const date = toDate(value);
  return date ? format(date, pattern) : '—';
}

export function formatDateTime(value: Timestamp | Date | null | undefined) {
  return formatDate(value, "MMM d, yyyy 'at' h:mm a");
}

/** Calendar-day difference so "expires today" reads as 0, not a fractional day. */
export function daysUntil(value: Timestamp | Date | null | undefined): number | null {
  const date = toDate(value);
  return date ? differenceInCalendarDays(date, new Date()) : null;
}

export function statusTone(status: MemberStatus): BadgeTone {
  switch (status) {
    case 'active':
      return 'success';
    case 'frozen':
      return 'warning';
    case 'expired':
    case 'cancelled':
      return 'danger';
    default:
      return 'neutral';
  }
}

/** Expiring-soon members get a warning tone even while technically active. */
export function membershipTone(status: MemberStatus, days: number | null): BadgeTone {
  if (status === 'active' && days !== null && days <= 30) return 'warning';
  return statusTone(status);
}

export function initialsOf(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}
