import { addMonths } from 'date-fns';

import { toDate } from '@/lib/format';
import type { Member, Plan } from '@/types/models';

/**
 * A renewal extends from the later of today or the current end date, so renewing early
 * never costs the member the days they already paid for.
 */
export function nextTermFor(member: Pick<Member, 'endDate'> | null, plan: Plan) {
  const now = new Date();
  const currentEnd = toDate(member?.endDate ?? null);
  const start = currentEnd && currentEnd > now ? currentEnd : now;
  return { start, end: addMonths(start, plan.durationMonths) };
}

export function termForNewMember(plan: Plan, startDate = new Date()) {
  return { start: startDate, end: addMonths(startDate, plan.durationMonths) };
}
