import { Timestamp } from 'firebase/firestore';

export type Role = 'member' | 'staff' | 'admin';

export type MemberStatus = 'active' | 'expired' | 'frozen' | 'cancelled';

export type PaymentMethod = 'cash' | 'card' | 'gcash' | 'bank' | 'other';

export type NotificationKind = 'expiry_90' | 'expiry_30' | 'expiry_7';

/** Auth-level profile. `role` is mirrored into a custom claim by the onUserCreate function. */
export interface UserDoc {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string | null;
  role: Role;
  pushToken?: string | null;
  emailOptIn: boolean;
  createdAt: Timestamp;
}

export interface EmergencyContact {
  name: string;
  phone: string;
  relationship?: string;
}

export interface Member {
  id: string;
  /** Auth uid, null for walk-in members registered by staff before they create a login. */
  uid: string | null;
  fullName: string;
  email: string;
  phone: string;
  planId: string;
  planName: string;
  startDate: Timestamp;
  endDate: Timestamp;
  status: MemberStatus;
  emergencyContact?: EmergencyContact;
  notes?: string;
  joinedAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Plan {
  id: string;
  name: string;
  priceCents: number;
  durationMonths: number;
  active: boolean;
  perks: string[];
  createdAt: Timestamp;
}

export interface Payment {
  id: string;
  memberId: string;
  memberName: string;
  planId: string;
  planName: string;
  amountCents: number;
  method: PaymentMethod;
  /** 'new' on first purchase, 'renewal' on every subsequent one. Drives the admin new-vs-renewal chart. */
  kind: 'new' | 'renewal';
  paidAt: Timestamp;
  periodStart: Timestamp;
  periodEnd: Timestamp;
  recordedBy: string;
}

export interface CheckIn {
  id: string;
  memberId: string;
  memberName: string;
  at: Timestamp;
  recordedBy: string;
}

/** Written only by the expiry function. Its existence is what makes the daily job idempotent. */
export interface NotificationLog {
  id: string;
  memberId: string;
  kind: NotificationKind;
  email: string;
  sentAt: Timestamp;
  gmailMessageId: string | null;
  status: 'sent' | 'failed';
  error?: string;
}

export interface DailyStats {
  id: string;
  revenueCents: number;
  newMembers: number;
  renewals: number;
  checkins: number;
}

export interface MonthlyStats {
  id: string;
  revenueCents: number;
  newMembers: number;
  renewals: number;
  checkins: number;
}

export interface Announcement {
  id: string;
  title: string;
  body: string;
  active: boolean;
  createdAt: Timestamp;
  createdBy: string;
}
