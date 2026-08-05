import { Timestamp } from 'firebase/firestore';

export type Role = 'member' | 'staff' | 'admin';

export type MemberStatus = 'active' | 'expired' | 'frozen' | 'cancelled';

export type PaymentMethod = 'cash' | 'card' | 'gcash' | 'bank' | 'other';

export type NotificationKind = 'expiry_90' | 'expiry_30' | 'expiry_7';

/** Auth-level profile. `role` is mirrored into a custom claim by the onUserCreate function. */
export interface UserDoc {
  uid: string;
  email: string;
  /** Lowercase, unique. The `usernames/{username}` doc is what actually enforces uniqueness. */
  username: string;
  firstName: string;
  /** Optional — plenty of people don't use one, and requiring it invents data. */
  middleName?: string | null;
  lastName: string;
  /**
   * Derived from the name parts at write time, not stored independently. It exists because
   * Firebase Auth carries a single `displayName`, and every avatar/greeting in the app already
   * reads this one field — recomputing "first middle last" at each call site would be worse.
   */
  displayName: string;
  phone: string;
  photoURL?: string | null;
  role: Role;
  pushToken?: string | null;
  emailOptIn: boolean;
  /**
   * Hidden from the Accounts list. Deliberately *not* a deletion: the Auth credential lives
   * outside Firestore and only the Admin SDK can remove it, so a hard delete would leave a
   * working login pointing at nothing. Absent on every account written before archiving
   * existed, which is why every read treats missing as `false`.
   */
  archived?: boolean;
  createdAt: Timestamp;
}

/**
 * Username reservation. The document *id* is the lowercased username, which is what makes
 * uniqueness real: Firestore `create` fails if the id already exists, and the rules forbid
 * update and delete, so a name cannot be stolen from its owner.
 */
export interface UsernameDoc {
  /** The doc id, echoed into the body so a read gives you the canonical casing back. */
  username: string;
  uid: string;
  /** Sign-in resolves username -> email here. See the note in firestore.rules. */
  email: string;
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
  /**
   * Canonical display and sort key, composed from the parts below. Kept as a stored field
   * rather than derived on read because it backs `orderBy('fullName')` and the search box.
   */
  fullName: string;
  firstName: string;
  middleName?: string | null;
  lastName: string;
  email: string;
  phone: string;
  planId: string;
  planName: string;
  startDate: Timestamp;
  endDate: Timestamp;
  status: MemberStatus;
  emergencyContact?: EmergencyContact;
  notes?: string;
  /** See `UserDoc.archived`. Set alongside `status: 'cancelled'`, and reversible. */
  archived?: boolean;
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
  /**
   * Null for a walk-in fee, which is charged to a person with no membership at all. Reading
   * this defensively matters beyond typing: `ownsMember()` in firestore.rules does a `get()` on
   * `members/{memberId}`, and a null id would *error* rule evaluation rather than merely fail
   * it — taking a member's whole receipt list down with it. Hence the `kind` guard on that rule.
   */
  memberId: string | null;
  memberName: string;
  planId: string;
  planName: string;
  amountCents: number;
  method: PaymentMethod;
  /**
   * 'new' on first purchase, 'renewal' on every subsequent one — together they drive the admin
   * new-vs-renewal chart. 'walkin' is a day-pass fee: no plan, no member, but real money, so it
   * lives here rather than in its own collection. One sum over `payments` is then the whole
   * revenue figure, and the CSV export needs no second source.
   */
  kind: 'new' | 'renewal' | 'walkin';
  /** Set only on a walk-in fee, linking it back to the `nonMembers` row that was scanned. */
  nonMemberId?: string | null;
  paidAt: Timestamp;
  periodStart: Timestamp;
  periodEnd: Timestamp;
  recordedBy: string;
}

/**
 * A walk-in who holds no membership. Created by the *staff* client when their QR pass is
 * scanned, never by the visitor's own device — an unauthenticated phone cannot write to
 * Firestore, and opening this collection to anonymous creates to work around that would be a
 * far worse trade than accepting the name is self-asserted.
 *
 * The id is minted on the visitor's device and carried in the QR, which is what lets a
 * returning walk-in merge into their existing record instead of spawning a duplicate.
 */
export interface NonMember {
  id: string;
  firstName: string;
  middleName?: string | null;
  lastName: string;
  /** Composed on write, same reason as `Member.fullName`: it backs the attendance search box. */
  fullName: string;
  visits: number;
  firstSeenAt: Timestamp;
  lastVisitAt: Timestamp;
}

export interface CheckIn {
  id: string;
  /**
   * Which kind of visitor this row is for. Read it through a default rather than assuming it
   * exists — rows written before non-members existed carry no `kind` at all, which is also why
   * the firestore.rules read branch uses `resource.data.get('kind','member')`.
   */
  kind: 'member' | 'nonmember';
  /** Null for a non-member. Keeps `q.checkinsForMember()` correct without a second collection. */
  memberId: string | null;
  nonMemberId: string | null;
  /** The name as it stood at scan time, whichever kind of visitor it was. */
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

/**
 * `settings/pricing` — the default day-pass fee, in centavos.
 *
 * A single stored number rather than a constant in the source, because the front desk changes
 * prices more often than the app ships. It is only a *default*: the walk-in form leaves the
 * amount editable so a visit can be comped or priced differently on the spot.
 */
export interface PricingSettings {
  walkInCents: number;
  updatedAt?: Timestamp;
  updatedBy?: string;
}
