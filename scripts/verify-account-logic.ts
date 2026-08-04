/**
 * Verifies the pure logic behind account creation: name composition, PH phone normalisation,
 * and username validation. None of it needs Firebase — the rules and the reservation
 * transaction do, and those are covered by the emulator suite, not here.
 *
 *   node --experimental-strip-types scripts/verify-account-logic.ts
 *
 * These three are worth pinning because each one silently corrupts data when it is wrong:
 * a bad split stores the wrong surname, a bad normalise stores an unreachable number, and a
 * loose username regex lets someone claim a name that reads as staff.
 */
import assert from 'node:assert/strict';

import { composeFullName, normalizeNameParts, splitFullName, greetingName } from '../lib/names.ts';
import { formatPhone, isValidPhone, normalizePhone } from '../lib/phone.ts';
import {
  canonicalizeUsername,
  looksLikeEmail,
  usernameSeed,
  validateUsername,
} from '../lib/usernameRules.ts';

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

console.log('\ncomposeFullName — the middle name is optional, so it must vanish cleanly');

check('all three parts join with single spaces', () => {
  assert.equal(
    composeFullName({ firstName: 'Juan', middleName: 'Santos', lastName: 'Dela Cruz' }),
    'Juan Santos Dela Cruz'
  );
});

check('missing middle name leaves no double space', () => {
  assert.equal(composeFullName({ firstName: 'Juan', lastName: 'Dela Cruz' }), 'Juan Dela Cruz');
  assert.equal(
    composeFullName({ firstName: 'Juan', middleName: null, lastName: 'Dela Cruz' }),
    'Juan Dela Cruz'
  );
  assert.equal(
    composeFullName({ firstName: 'Juan', middleName: '   ', lastName: 'Dela Cruz' }),
    'Juan Dela Cruz'
  );
});

check('surrounding whitespace is trimmed off each part', () => {
  assert.equal(
    composeFullName({ firstName: '  Juan ', middleName: ' Santos ', lastName: ' Dela Cruz  ' }),
    'Juan Santos Dela Cruz'
  );
});

check('empty middle name normalises to null, not an empty string', () => {
  // Firestore treats "" and null differently on read; null is the one the type declares.
  assert.equal(normalizeNameParts({ firstName: 'A', middleName: '', lastName: 'B' }).middleName, null);
  assert.equal(normalizeNameParts({ firstName: 'A', middleName: '  ', lastName: 'B' }).middleName, null);
  assert.equal(
    normalizeNameParts({ firstName: 'A', middleName: 'M', lastName: 'B' }).middleName,
    'M'
  );
});

console.log('\nsplitFullName — legacy records only; it guesses, so pin what it guesses');

check('two words are first and last, no middle', () => {
  assert.deepEqual(splitFullName('Juan Cruz'), {
    firstName: 'Juan',
    middleName: null,
    lastName: 'Cruz',
  });
});

check('three or more words put everything in between into the middle', () => {
  assert.deepEqual(splitFullName('Juan Santos Dela Cruz'), {
    firstName: 'Juan',
    middleName: 'Santos Dela',
    lastName: 'Cruz',
  });
});

check('a single word is a first name with no surname', () => {
  assert.deepEqual(splitFullName('Madonna'), {
    firstName: 'Madonna',
    middleName: null,
    lastName: '',
  });
});

check('empty input does not throw', () => {
  assert.deepEqual(splitFullName('   '), { firstName: '', middleName: null, lastName: '' });
});

check('greetingName prefers the first non-blank candidate', () => {
  assert.equal(greetingName([null, '  ', 'Juan Dela Cruz']), 'Juan');
  assert.equal(greetingName([undefined, null]), 'there');
  // A stored first name is used whole — it is already just the first name.
  assert.equal(greetingName(['Juan']), 'Juan');
});

console.log('\nnormalizePhone — the same number written four ways must store identically');

check('all four local spellings collapse to one canonical form', () => {
  const canonical = '+639171234567';
  assert.equal(normalizePhone('09171234567'), canonical);
  assert.equal(normalizePhone('+639171234567'), canonical);
  assert.equal(normalizePhone('639171234567'), canonical);
  assert.equal(normalizePhone('9171234567'), canonical);
});

check('spaces, dashes and parentheses are ignored', () => {
  assert.equal(normalizePhone('0917 123 4567'), '+639171234567');
  assert.equal(normalizePhone('0917-123-4567'), '+639171234567');
  assert.equal(normalizePhone('(0917) 123 4567'), '+639171234567');
  assert.equal(normalizePhone('  +63 917 123 4567  '), '+639171234567');
});

check('landlines and wrong-length numbers are rejected', () => {
  assert.equal(normalizePhone('028123456'), null, 'Manila landline');
  assert.equal(normalizePhone('0917123456'), null, 'one digit short');
  assert.equal(normalizePhone('091712345678'), null, 'one digit long');
  assert.equal(normalizePhone('08171234567'), null, 'mobile prefix must be 9');
  assert.equal(normalizePhone(''), null);
  assert.equal(normalizePhone('not a phone'), null);
});

check('a foreign number is rejected rather than silently stored', () => {
  assert.equal(normalizePhone('+14155552671'), null);
});

check('isValidPhone agrees with normalizePhone', () => {
  assert.equal(isValidPhone('0917 123 4567'), true);
  assert.equal(isValidPhone('028123456'), false);
});

check('formatPhone round-trips back to the local spelling', () => {
  assert.equal(formatPhone('+639171234567'), '0917 123 4567');
  // Unrecognised input is passed through rather than mangled.
  assert.equal(formatPhone('whatever'), 'whatever');
});

console.log('\nvalidateUsername — this decides what a member can call themselves');

check('a normal username is accepted', () => {
  assert.equal(validateUsername('juan.delacruz'), null);
  assert.equal(validateUsername('juan_dc'), null);
  assert.equal(validateUsername('jd2026'), null);
});

check('case is irrelevant — canonical form is lowercase', () => {
  assert.equal(canonicalizeUsername('  JuanDC  '), 'juandc');
  assert.equal(validateUsername('JuanDC'), null);
});

check('length bounds are enforced', () => {
  assert.notEqual(validateUsername('ab'), null, 'too short');
  assert.equal(validateUsername('abc'), null, 'minimum is 3');
  assert.equal(validateUsername('a'.repeat(20)), null, 'maximum is 20');
  assert.notEqual(validateUsername('a'.repeat(21)), null, 'too long');
});

check('reserved names cannot be claimed', () => {
  // A member calling themselves "admin" can talk other members into anything.
  for (const name of ['admin', 'staff', 'support', 'ADMIN', 'hardcore']) {
    assert.notEqual(validateUsername(name), null, `${name} should be reserved`);
  }
});

check('malformed usernames are rejected', () => {
  assert.notEqual(validateUsername('2fast'), null, 'must start with a letter');
  assert.notEqual(validateUsername('juan dc'), null, 'no spaces');
  assert.notEqual(validateUsername('juan..dc'), null, 'no consecutive separators');
  assert.notEqual(validateUsername('juan.'), null, 'no trailing separator');
  assert.notEqual(validateUsername('juan-dc'), null, 'hyphen is not permitted');
  assert.notEqual(validateUsername('juan@dc'), null, 'no @');
  assert.notEqual(validateUsername(''), null, 'empty');
});

check('an email-shaped input is rejected with the @ hint', () => {
  const problem = validateUsername('juan@example.com');
  assert.ok(problem?.includes('@'), 'should explain that @ looks like an email');
});

console.log('\nlooksLikeEmail — decides which branch sign-in takes');

check('splits identifiers on the presence of @', () => {
  assert.equal(looksLikeEmail('juan@example.com'), true);
  assert.equal(looksLikeEmail('juan.delacruz'), false);
});

console.log('\nusernameSeed — the suggestion offered on the signup form');

check('a normal name becomes first.last', () => {
  assert.equal(usernameSeed('Juan', 'Cruz'), 'juan.cruz');
});

check('spaces and punctuation in a surname are stripped, not left in', () => {
  // "Dela Cruz" must not produce "juan.dela cruz" — a space fails validateUsername.
  assert.equal(usernameSeed('Juan', 'Dela Cruz'), 'juan.delacruz');
  // An apostrophe is dropped, but a period the user typed is kept as a separator.
  assert.equal(usernameSeed("Ma. Ana", "O'Brien"), 'ma.ana.obrien');
});

check('a seed long enough to be cut never ends in a separator', () => {
  // Truncating to 18 chars can land on the '.', which the username regex rejects.
  const seed = usernameSeed('Bartholomewxyz', 'Q');
  assert.equal(seed, 'bartholomewxyz.q');
  assert.equal(validateUsername(seed), null, 'the seed it suggests must itself be valid');
});

check('every suggestion is a valid username or empty', () => {
  const cases: Array<[string, string]> = [
    ['Juan', 'Cruz'],
    ['Juan', 'Dela Cruz'],
    ['José', 'Ñuñez'],
    ['A', 'B'],
    ['', ''],
    ['123', '456'],
    ['Christopherjonathan', 'Villanuevamacapagal'],
  ];
  for (const [first, last] of cases) {
    const seed = usernameSeed(first, last);
    if (seed === '') continue;
    assert.equal(validateUsername(seed), null, `usernameSeed(${first}, ${last}) = "${seed}"`);
  }
});

check('a name with nothing usable yields an empty suggestion, not garbage', () => {
  assert.equal(usernameSeed('', ''), '');
  assert.equal(usernameSeed('123', '456'), '');
});

console.log(`\n${passed} checks passed\n`);
