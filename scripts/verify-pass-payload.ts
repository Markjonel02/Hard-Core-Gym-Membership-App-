/**
 * Verifies the QR pass payload codec — the contract between the device that shows a pass and the
 * scanner that reads it.
 *
 *   node --experimental-strip-types scripts/verify-pass-payload.ts
 *
 * Worth pinning here rather than driving through the UI: exercising the scanner for real needs a
 * camera, so these are the only checks that ever run against `parsePass`. Each case below is a
 * way the front desk breaks. A dropped `kind` checks a member in as a walk-in. A pass parsed
 * without an id creates a fresh `nonMembers` row on every visit, so the log stops counting unique
 * visitors. And `parsePass` sees every barcode the camera is ever pointed at, so anything it
 * cannot recognise has to come back null instead of throwing.
 */
import assert from 'node:assert/strict';

import {
  buildMemberPass,
  buildNonMemberPass,
  parsePass,
  passDisplayName,
  PASS_TAG,
  PASS_VERSION,
} from '../lib/passPayload.ts';

let passed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (error) {
    console.error(`  FAIL ${name}`);
    console.error(`       ${(error as Error).message}`);
    process.exitCode = 1;
  }
}

console.log('\nround trips — what one side writes, the other must read back identically');

check('a member pass survives build -> parse', () => {
  const parsed = parsePass(buildMemberPass('member123'));
  assert.deepEqual(parsed, { kind: 'member', memberId: 'member123' });
});

check('a walk-in pass survives build -> parse with all three name parts', () => {
  const parsed = parsePass(
    buildNonMemberPass({
      id: 'nm1',
      firstName: 'Marco',
      middleName: 'Reyes',
      lastName: 'Bautista',
    })
  );
  assert.deepEqual(parsed, {
    kind: 'nonmember',
    nonMember: { id: 'nm1', firstName: 'Marco', middleName: 'Reyes', lastName: 'Bautista' },
  });
});

check('an absent middle name round trips as null, not "undefined"', () => {
  const parsed = parsePass(buildNonMemberPass({ id: 'nm2', firstName: 'Ana', lastName: 'Cruz' }));
  assert.equal(parsed?.kind, 'nonmember');
  assert.equal(parsed.kind === 'nonmember' && parsed.nonMember.middleName, null);
});

check('names are trimmed on the way in, so the log has no ragged whitespace', () => {
  const parsed = parsePass(
    buildNonMemberPass({ id: 'nm3', firstName: '  Ana ', middleName: ' ', lastName: ' Cruz  ' })
  );
  assert.equal(parsed?.kind, 'nonmember');
  if (parsed.kind !== 'nonmember') return;
  assert.equal(parsed.nonMember.firstName, 'Ana');
  assert.equal(parsed.nonMember.lastName, 'Cruz');
  assert.equal(parsed.nonMember.middleName, null);
});

console.log('\nkind discrimination — mixing these up checks the wrong person in');

check('a member pass never parses as a walk-in', () => {
  const parsed = parsePass(buildMemberPass('m1'));
  assert.equal(parsed?.kind, 'member');
});

check('a walk-in pass never parses as a member', () => {
  const parsed = parsePass(buildNonMemberPass({ id: 'nm4', firstName: 'A', lastName: 'B' }));
  assert.equal(parsed?.kind, 'nonmember');
});

check('a pass with no kind is treated as a member — those predate walk-ins', () => {
  const legacy = JSON.stringify({ t: PASS_TAG, v: PASS_VERSION, memberId: 'old1' });
  assert.deepEqual(parsePass(legacy), { kind: 'member', memberId: 'old1' });
});

check('an unknown kind is refused rather than guessed at', () => {
  const future = JSON.stringify({ t: PASS_TAG, v: PASS_VERSION, kind: 'staff', memberId: 'x' });
  assert.equal(parsePass(future), null);
});

console.log('\nrejection — the camera sees the whole world, and none of it may throw');

check('random non-JSON returns null', () => {
  for (const raw of ['', 'hello', 'https://example.com', '{oops', 'WIFI:S:net;T:WPA;', '42']) {
    assert.equal(parsePass(raw), null, `expected null for ${JSON.stringify(raw)}`);
  }
});

check('valid JSON that is not an object returns null', () => {
  for (const raw of ['null', '"a string"', '[1,2,3]', 'true']) {
    assert.equal(parsePass(raw), null, `expected null for ${raw}`);
  }
});

check('another app’s QR with the wrong tag is refused', () => {
  const foreign = JSON.stringify({ t: 'other-gym', v: 1, kind: 'member', memberId: 'm1' });
  assert.equal(parsePass(foreign), null);
});

check('a future payload version is refused rather than misread', () => {
  const next = JSON.stringify({
    t: PASS_TAG,
    v: PASS_VERSION + 1,
    kind: 'member',
    memberId: 'm1',
  });
  assert.equal(parsePass(next), null);
});

check('a member pass with no id is refused', () => {
  for (const memberId of ['', null, 123, undefined]) {
    const raw = JSON.stringify({ t: PASS_TAG, v: PASS_VERSION, kind: 'member', memberId });
    assert.equal(parsePass(raw), null, `expected null for memberId ${String(memberId)}`);
  }
});

check('a walk-in pass missing the id is refused — it could not merge into one record', () => {
  const raw = JSON.stringify({
    t: PASS_TAG,
    v: PASS_VERSION,
    kind: 'nonmember',
    first: 'Ana',
    last: 'Cruz',
  });
  assert.equal(parsePass(raw), null);
});

check('a walk-in pass missing a name is refused — it would log an anonymous row', () => {
  const noFirst = JSON.stringify({
    t: PASS_TAG,
    v: PASS_VERSION,
    kind: 'nonmember',
    id: 'nm5',
    last: 'Cruz',
  });
  const noLast = JSON.stringify({
    t: PASS_TAG,
    v: PASS_VERSION,
    kind: 'nonmember',
    id: 'nm5',
    first: 'Ana',
  });
  assert.equal(parsePass(noFirst), null);
  assert.equal(parsePass(noLast), null);
});

console.log('\npassDisplayName — what the desk and the attendance log show');

check('all three parts join with single spaces', () => {
  assert.equal(
    passDisplayName({ id: 'x', firstName: 'Marco', middleName: 'Reyes', lastName: 'Bautista' }),
    'Marco Reyes Bautista'
  );
});

check('a missing middle name leaves no double space', () => {
  assert.equal(passDisplayName({ id: 'x', firstName: 'Ana', lastName: 'Cruz' }), 'Ana Cruz');
  assert.equal(
    passDisplayName({ id: 'x', firstName: 'Ana', middleName: null, lastName: 'Cruz' }),
    'Ana Cruz'
  );
  assert.equal(
    passDisplayName({ id: 'x', firstName: 'Ana', middleName: '   ', lastName: 'Cruz' }),
    'Ana Cruz'
  );
});

console.log(`\n${passed} checks passed\n`);
