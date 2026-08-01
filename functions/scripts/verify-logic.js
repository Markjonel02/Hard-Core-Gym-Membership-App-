/**
 * Verifies the two pure functions that decide when a member gets emailed and which day a
 * payment counts toward. Both are date math, which is where off-by-one and timezone bugs
 * hide, and neither needs the emulator — so this runs anywhere `npm run build` has run.
 *
 *   node scripts/verify-logic.js
 */
const assert = require('node:assert/strict');

const { HORIZONS, daysBetweenUtc } = require('../lib/expiry.js');
const { bucketIds } = require('../lib/aggregates.js');

let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (error) {
    console.error(`  FAIL ${name}`);
    console.error(`       ${error.message}`);
    process.exitCode = 1;
  }
}

console.log('\ndaysBetweenUtc — the 3-month trigger depends on this being exact');

check('same calendar day is 0', () => {
  assert.equal(daysBetweenUtc(new Date('2026-03-01T00:00:00Z'), new Date('2026-03-01T23:59:59Z')), 0);
});

check('ignores time of day (23:59 -> 00:01 next day is 1, not 0)', () => {
  assert.equal(daysBetweenUtc(new Date('2026-03-01T23:59:00Z'), new Date('2026-03-02T00:01:00Z')), 1);
});

check('90 days out lands exactly on the 90 horizon', () => {
  const from = new Date('2026-01-01T00:00:00Z');
  const to = new Date('2026-04-01T00:00:00Z'); // Jan(31) + Feb(28) + Mar(31) = 90
  assert.equal(daysBetweenUtc(from, to), 90);
  assert.ok(HORIZONS.includes(daysBetweenUtc(from, to)), 'should match a horizon');
});

check('leap-year February is counted', () => {
  // 2028 is a leap year: Jan 31 + Feb 29 = 60 days from Jan 1 to Mar 1.
  assert.equal(daysBetweenUtc(new Date('2028-01-01T00:00:00Z'), new Date('2028-03-01T00:00:00Z')), 60);
});

check('already expired yields a negative count', () => {
  assert.equal(daysBetweenUtc(new Date('2026-03-10T00:00:00Z'), new Date('2026-03-09T00:00:00Z')), -1);
});

check('crossing a DST boundary does not drift', () => {
  // US DST starts 2026-03-08. UTC math must be immune to it.
  assert.equal(daysBetweenUtc(new Date('2026-03-07T12:00:00Z'), new Date('2026-03-09T12:00:00Z')), 2);
});

check('horizons are 90/30/7, descending', () => {
  assert.deepEqual(HORIZONS, [90, 30, 7]);
});

console.log('\nbucketIds — a late-night payment must count on the gym local day');

check('midday Manila maps to that date', () => {
  assert.deepEqual(bucketIds(new Date('2026-05-14T04:00:00Z')), { day: '2026-05-14', month: '2026-05' });
});

check('21:00 Manila (13:00 UTC) counts on the same local day', () => {
  // Manila is UTC+8, so 13:00Z is 21:00 local — still the 14th locally.
  assert.deepEqual(bucketIds(new Date('2026-05-14T13:00:00Z')), { day: '2026-05-14', month: '2026-05' });
});

check('17:00 UTC is already the next Manila day', () => {
  // 17:00Z = 01:00 next day in Manila. A naive UTC bucket would file this a day early.
  assert.deepEqual(bucketIds(new Date('2026-05-14T17:00:00Z')), { day: '2026-05-15', month: '2026-05' });
});

check('month rolls over on the Manila boundary, not the UTC one', () => {
  // 2026-05-31T18:00Z = 2026-06-01T02:00 Manila -> June.
  assert.deepEqual(bucketIds(new Date('2026-05-31T18:00:00Z')), { day: '2026-06-01', month: '2026-06' });
});

check('day ids sort lexically (YYYY-MM-DD)', () => {
  const ids = ['2026-05-14T04:00:00Z', '2026-01-02T04:00:00Z', '2026-12-31T04:00:00Z']
    .map((iso) => bucketIds(new Date(iso)).day);
  assert.deepEqual([...ids].sort(), ['2026-01-02', '2026-05-14', '2026-12-31']);
});

check('month id is the day id prefix', () => {
  const { day, month } = bucketIds(new Date('2026-09-03T04:00:00Z'));
  assert.equal(day.slice(0, 7), month);
});

console.log(`\n${passed} checks passed${process.exitCode ? ' — with failures above' : ''}\n`);
