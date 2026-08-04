/**
 * TEMPORARY diagnostic — delete after use.
 * Prints what actually exists in Firestore and Auth so fixes are based on data, not guesses.
 */
const { existsSync } = require('node:fs');
const { resolve } = require('node:path');
const { initializeApp, cert, applicationDefault } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');

const KEY_PATH = resolve(__dirname, '..', 'serviceAccountKey.json');
const credential = process.env.GOOGLE_APPLICATION_CREDENTIALS
  ? applicationDefault()
  : cert(require(KEY_PATH));

initializeApp({ credential });
const db = getFirestore();
const auth = getAuth();

async function dump(name) {
  const snap = await db.collection(name).get();
  console.log(`\n=== ${name} (${snap.size}) ===`);
  snap.forEach((d) => {
    const v = d.data();
    if (name === 'members') {
      console.log(
        `  ${d.id} uid=${v.uid ?? 'NULL'} name=${v.fullName} status=${v.status} end=${v.endDate?.toDate?.()?.toISOString?.().slice(0, 10)}`
      );
    } else if (name === 'users') {
      console.log(`  ${d.id} email=${v.email} role=${v.role ?? '(none)'} name=${v.displayName}`);
    } else if (name === 'plans') {
      console.log(`  ${d.id} name=${v.name} active=${v.active} price=${v.priceCents}`);
    } else {
      console.log(`  ${d.id} ${JSON.stringify(v).slice(0, 140)}`);
    }
  });
}

async function tryQuery(label, build) {
  try {
    const snap = await build();
    console.log(`  OK   ${label} -> ${snap.size} doc(s)`);
  } catch (e) {
    console.log(`  FAIL ${label} -> ${e.code ?? ''} ${e.message.split('\n')[0].slice(0, 200)}`);
  }
}

(async () => {
  for (const c of ['users', 'members', 'plans', 'payments', 'checkins']) await dump(c);

  console.log('\n=== auth accounts ===');
  const { users } = await auth.listUsers(50);
  for (const u of users) {
    console.log(
      `  ${u.email} uid=${u.uid} role=${u.customClaims?.role ?? '(none)'} verified=${u.emailVerified}`
    );
  }

  console.log('\n=== composite-index-dependent queries (admin SDK bypasses rules, not indexes) ===');
  await tryQuery("plans where active==true orderBy priceCents", () =>
    db.collection('plans').where('active', '==', true).orderBy('priceCents').get()
  );
  await tryQuery("members where status==active orderBy fullName", () =>
    db.collection('members').where('status', '==', 'active').orderBy('fullName').get()
  );
  await tryQuery("members where status==active endDate<=cutoff orderBy endDate", () =>
    db
      .collection('members')
      .where('status', '==', 'active')
      .where('endDate', '<=', new Date(Date.now() + 90 * 864e5))
      .orderBy('endDate')
      .get()
  );
  await tryQuery("members orderBy fullName", () => db.collection('members').orderBy('fullName').get());
  await tryQuery("payments orderBy paidAt desc", () =>
    db.collection('payments').orderBy('paidAt', 'desc').limit(8).get()
  );
  await tryQuery("stats/monthly/entries", () =>
    db.collection('stats').doc('monthly').collection('entries').get()
  );
  process.exit(0);
})().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
