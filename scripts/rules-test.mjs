/**
 * Behavioural test for firestore.rules, run against the Firestore + Auth
 * emulators.
 *
 * Why this exists: the rules are the only thing standing between the public
 * internet and the cafe's order book, and they are not TypeScript, so nothing
 * else in this repo checks them. A syntax error in here once shipped unnoticed
 * and only surfaced at `firebase deploy`. This is the test that should have
 * existed from the start.
 *
 * Two deliberate choices:
 *
 * - It drives the real client SDK, not the REST API. The rules pin
 *   `createdAt == request.time` and only `serverTimestamp()` produces that; a
 *   REST-created document always carries a client-chosen timestamp, so REST
 *   cannot exercise that clause at all.
 *
 * - It signs real users in against the Auth emulator, because the difference
 *   between staff and owner is the whole point of the role helper. A second
 *   un-authenticated app would not be testing it.
 *
 *   npm run emulators            # terminal 1
 *   npm run test:rules           # terminal 2
 *
 * or in one command, which starts and stops the emulators itself:
 *
 *   firebase emulators:exec --only auth,firestore --project demo-cafe "npm run test:rules"
 *
 * The emulators need Java 21+. The project id defaults to demo-cafe
 * (FIRESTORE_EMULATOR_PROJECT overrides it); a demo- project cannot reach any
 * real Firebase project. CI runs this on every pull request.
 */
import { initializeApp, deleteApp } from "firebase/app";
import {
  connectAuthEmulator,
  getAuth,
  signInWithEmailAndPassword,
  signInAnonymously,
  signOut,
} from "firebase/auth";
import {
  connectFirestoreEmulator,
  getFirestore,
  collection,
  doc,
  addDoc,
  setDoc,
  getDocs,
  getDoc,
  deleteDoc,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";

const PROJECT = process.env.FIRESTORE_EMULATOR_PROJECT ?? "demo-cafe";
// `firebase emulators:exec` exports FIRESTORE_EMULATOR_HOST and
// FIREBASE_AUTH_EMULATOR_HOST as "host:port", so split them rather than
// gluing a second port onto the end.
const [fsEnvHost, fsEnvPort] = (
  process.env.FIRESTORE_EMULATOR_HOST ?? ""
).split(":");
const [, authEnvPort] = (process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "").split(
  ":",
);
const HOST = fsEnvHost || "127.0.0.1";
const FS_PORT = Number(
  process.env.FIRESTORE_EMULATOR_PORT || fsEnvPort || 8080,
);
const AUTH_PORT = Number(
  process.env.FIREBASE_AUTH_EMULATOR_PORT || authEnvPort || 9099,
);
const CFG = { projectId: PROJECT, apiKey: "demo", authDomain: "demo.local" };

const app = (name) => {
  const a = initializeApp(CFG, name);
  const auth = getAuth(a);
  connectAuthEmulator(auth, `http://${HOST}:${AUTH_PORT}`, {
    disableWarnings: true,
  });
  const db = getFirestore(a);
  connectFirestoreEmulator(db, HOST, FS_PORT);
  return { a, auth, db };
};
const publicC = app("public");
// Never signs in at all: the caller issue #30 was about.
const nobodyC = app("nobody");
// A second anonymous caller stands in for "a different customer's phone": the
// rule must let each one read their own order and nothing else.
const otherCustomerC = app("other-customer");
// Handing out the owner role is destructive, so it gets its own throwaway
// account. Promoting the barista would quietly turn it into an owner and make
// every later run fail for a reason that has nothing to do with the rules.
const tempC = app("temp-user");
const staffC = app("staff");
const ownerC = app("owner");

let pass = 0;
const failures = [];
async function t(label, fn) {
  try {
    await fn();
    pass += 1;
    console.log(`  ok    ${label}`);
  } catch (e) {
    const msg = String(e?.message ?? e)
      .split("\n")[0]
      .trim()
      .slice(0, 64);
    failures.push(label);
    console.log(`  FAIL  ${label}  -> ${msg}`);
  }
}
// A denial has to be the rules saying no. Accepting any error would let a
// broken setup step (a failed sign-in, a typo'd path, a network blip) pass as
// "denied", and the suite would stay green while testing nothing.
const denied = (fn) => async () => {
  try {
    await fn();
  } catch (e) {
    if (e?.code === "permission-denied") return;
    throw new Error(
      `failed, but not with permission-denied: ${e?.code ?? ""} ${String(
        e?.message ?? e,
      )
        .split("\n")[0]
        .slice(0, 40)}`,
    );
  }
  throw new Error("was ALLOWED but should have been denied");
};
const allowed = (fn) => async () => {
  try {
    await fn();
  } catch (e) {
    throw new Error(
      `was DENIED: ${String(e?.message ?? e)
        .split("\n")[0]
        .slice(0, 50)}`,
    );
  }
};

// Create the two accounts, then give one of them the owner document that
// isOwner() looks for. The document is seeded over REST with the emulator's
// admin token, because an owner cannot be created by a non-owner.
const AUTH_BASE = `http://${HOST}:${AUTH_PORT}/identitytoolkit.googleapis.com/v1`;
// Idempotent: the emulators keep state between runs, so a second run hits
// EMAIL_EXISTS. Sign in instead. A test that only passes on a pristine emulator
// is a test that lies to you about whether it works.
const account = async (email) => {
  const creds = { email, password: "correct-horse", returnSecureToken: true };
  const post = (path) =>
    fetch(`${AUTH_BASE}/${path}?key=demo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(creds),
    }).then((r) => r.json());
  const up = await post("accounts:signUp");
  if (up.localId) return up;
  const res = await post("accounts:signInWithPassword");
  if (!res.localId)
    throw new Error(`could not provision ${email}: ${JSON.stringify(res)}`);
  return res;
};

const ownerAcct = await account("owner@cafe.test");
const staffAcct = await account("staff@cafe.test");
await fetch(
  `http://${HOST}:${FS_PORT}/v1/projects/${PROJECT}/databases/(default)/documents/staff/${ownerAcct.localId}`,
  {
    // PATCH, not POST: the emulator's REST layer rejects POST to a path with an
    // explicit document id ("parent name lacks /"), and a silently-missing role
    // document is indistinguishable from a broken isOwner().
    method: "PATCH",
    headers: {
      Authorization: "Bearer owner",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fields: { role: { stringValue: "owner" } } }),
  },
).then(async (r) => {
  if (!r.ok)
    throw new Error(
      `could not seed the owner role: ${r.status} ${await r.text()}`,
    );
});
await signInWithEmailAndPassword(
  staffC.auth,
  "staff@cafe.test",
  "correct-horse",
);
await signInWithEmailAndPassword(
  ownerC.auth,
  "owner@cafe.test",
  "correct-horse",
);
publicC.user = (await signInAnonymously(publicC.auth)).user;
otherCustomerC.user = (await signInAnonymously(otherCustomerC.auth)).user;
// The emulators keep data between runs, so a previous run may have left the
// barista holding a role. Clear it so "barista" means barista every time.
await fetch(
  `http://${HOST}:${FS_PORT}/v1/projects/${PROJECT}/databases/(default)/documents/staff/${staffAcct.localId}`,
  { method: "DELETE", headers: { Authorization: "Bearer owner" } },
);
const tempAcct = await account("temp@cafe.test");
await signInWithEmailAndPassword(tempC.auth, "temp@cafe.test", "correct-horse");

const line = (o = {}) => ({ name: "Espresso", qty: 2, price: 120, ...o });
// No orderNumber: the display number is derived from the document id on read,
// so the client has nothing to send (issue #30).
const order = (o = {}) => ({
  tableNumber: 3,
  items: [line()],
  total: 240,
  status: "preparing",
  createdAt: serverTimestamp(),
  notes: "",
  paymentMethod: "counter",
  ...o,
});
// Mirrors firestoreOrderRepo.create() in src/lib/data/firestore.ts: the order,
// pinned to the caller's anonymous uid, and the caller's throttle stamp, in one
// batch (issue #32). `stamp` overrides let a test forge the stamp.
const commitOrder = async (c, o = {}, stamp = {}) => {
  const uid = c.auth.currentUser.uid;
  const ref = doc(collection(c.db, "orders"));
  const batch = writeBatch(c.db);
  batch.set(ref, order({ customerUid: uid, ...o }));
  batch.set(doc(c.db, "orderThrottle", uid), {
    lastOrderAt: serverTimestamp(),
    lastOrderId: ref.id,
    ...stamp,
  });
  await batch.commit();
  return ref;
};
// A brand-new anonymous customer per order, so the 30-second throttle is never
// the reason a shape test passes or fails. signInAnonymously() hands back the
// existing anonymous user if there is one, hence the sign-out first. The
// throttle has its own section below, which keeps one uid on purpose.
const freshCustomer = async (c) => {
  await signOut(c.auth);
  return (await signInAnonymously(c.auth)).user;
};
const placeAs = async (c, o) => {
  await freshCustomer(c);
  return commitOrder(c, o);
};
// Plants a throttle stamp as if the customer's last order were `secondsAgo` in
// the past, over REST with the emulator's admin token. The alternative is a
// test that sleeps for half a minute on every run.
const seedStamp = async (uid, secondsAgo) => {
  const r = await fetch(
    `http://${HOST}:${FS_PORT}/v1/projects/${PROJECT}/databases/(default)/documents/orderThrottle/${uid}`,
    {
      method: "PATCH",
      headers: {
        Authorization: "Bearer owner",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        fields: {
          lastOrderAt: {
            timestampValue: new Date(
              Date.now() - secondsAgo * 1000,
            ).toISOString(),
          },
          lastOrderId: { stringValue: "seeded" },
        },
      }),
    },
  );
  if (!r.ok) throw new Error(`could not seed a stamp: ${r.status}`);
};

console.log(`\nfirestore.rules vs the emulators (${PROJECT})\n`);
console.log(" anonymous customer (an anonymous uid, not an account)");
await t(
  "can place a valid order",
  allowed(() => placeAs(publicC)),
);
await t(
  "cannot set status=completed",
  denied(() => placeAs(publicC, { status: "completed" })),
);
await t(
  "cannot send total as a string",
  denied(() => placeAs(publicC, { total: "240" })),
);
await t(
  "cannot send a negative total",
  denied(() => placeAs(publicC, { total: -500 })),
);
await t(
  "cannot inject an extra field",
  denied(() => placeAs(publicC, { completedAt: serverTimestamp() })),
);
await t(
  "cannot send an empty basket",
  denied(() => placeAs(publicC, { items: [] })),
);
await t(
  "cannot send 51 line items",
  denied(() => placeAs(publicC, { items: Array(51).fill(line()) })),
);
await t(
  "cannot use tableNumber 0",
  denied(() => placeAs(publicC, { tableNumber: 0 })),
);
await t(
  "cannot invent a payment method",
  denied(() => placeAs(publicC, { paymentMethod: "wire" })),
);
await t(
  "cannot backdate createdAt",
  denied(() => placeAs(publicC, { createdAt: new Date(2020, 0, 1) })),
);
await t(
  "cannot set qty 0 on a line",
  denied(() => placeAs(publicC, { items: [line({ qty: 0 })] })),
);
await t(
  "cannot set an absurd unit price",
  denied(() => placeAs(publicC, { items: [line({ price: 999999 })] })),
);
// `get` and `list` are separate rules, and the difference is not academic: a
// single `allow read: if isStaff() || resource.data.customerUid == ...` leaves
// Firestore unable to prove a list query is safe, and the staff board fails with
// "Missing or insufficient permissions" while single reads carry on working.
await t(
  "a customer can get their own order by id",
  allowed(async () => {
    const mine = await placeAs(publicC, { notes: "get me" });
    const snap = await getDoc(doc(publicC.db, "orders", mine.id));
    if (!snap.exists()) throw new Error("could not read its own order");
  }),
);
await t(
  "a customer cannot get somebody else's order by id",
  denied(async () => {
    const other = await placeAs(otherCustomerC, { notes: "not yours" });
    const snap = await getDoc(doc(publicC.db, "orders", other.id));
    if (snap.exists()) throw new Error("read a stranger's order");
  }),
);
await t(
  "cannot list a board at all",
  denied(() => getDocs(collection(publicC.db, "orders"))),
);
await t(
  "cannot list a board containing another customer's order",
  denied(() => getDocs(collection(publicC.db, "orders"))),
);
await t(
  "cannot rewrite a placed order",
  denied(async () => {
    // Its own order, so the refusal is about rewriting, not about ownership.
    const mine = await placeAs(publicC);
    await setDoc(
      doc(publicC.db, "orders", mine.id),
      { total: 1 },
      { merge: true },
    );
  }),
);
await t(
  "cannot write the menu",
  denied(() =>
    addDoc(collection(publicC.db, "menu"), { name: "Hack", price: 0 }),
  ),
);
await t(
  "cannot grant themselves owner",
  denied(() => setDoc(doc(publicC.db, "staff", "me"), { role: "owner" })),
);
await t(
  "cannot write an unknown collection",
  denied(() => addDoc(collection(publicC.db, "secrets"), { a: 1 })),
);
// Issue #30: /meta/counters used to be writable by anyone. The display number is
// derived from the order id now, so nothing needs it and nobody may write it.
await t(
  "cannot send an orderNumber on an order",
  denied(() => placeAs(publicC, { orderNumber: 101 })),
);
await t(
  "cannot write meta/counters (the old order counter)",
  denied(() =>
    setDoc(doc(publicC.db, "meta", "counters"), { orderNumber: 999999 }),
  ),
);
await t(
  "cannot reset meta/counters with a merge",
  denied(() =>
    setDoc(
      doc(publicC.db, "meta", "counters"),
      { orderNumber: 0 },
      { merge: true },
    ),
  ),
);
await t(
  "cannot write any other /meta document",
  denied(() => setDoc(doc(publicC.db, "meta", "anything"), { a: 1 })),
);

console.log("\n signed-out caller (no auth at all)");
await t(
  "cannot write meta/counters",
  denied(() =>
    setDoc(doc(nobodyC.db, "meta", "counters"), { orderNumber: 999999 }),
  ),
);
await t(
  "cannot read meta/counters",
  denied(() => getDoc(doc(nobodyC.db, "meta", "counters"))),
);
await t(
  "cannot place an order without an anonymous uid",
  denied(() =>
    addDoc(collection(nobodyC.db, "orders"), order({ customerUid: "x" })),
  ),
);

// Issue #32: one order per anonymous uid per 30 seconds. Unlike placeAs(), these
// deliberately keep ONE customer across tests, because the clock is the subject.
console.log("\n order throttle (one customer, one uid)");
const throttleC = app("throttle");
const loner = app("throttle-forger");
const throttleUid = (await freshCustomer(throttleC)).uid;
await t(
  "a first order from a new customer goes through",
  allowed(() => commitOrder(throttleC)),
);
await t(
  "a second order seconds later is refused",
  denied(() => commitOrder(throttleC)),
);
await t(
  "a customer can read their own throttle stamp",
  allowed(async () => {
    const snap = await getDoc(doc(throttleC.db, "orderThrottle", throttleUid));
    if (!snap.exists()) throw new Error("the stamp was not written");
  }),
);
await t(
  "cannot delete their own stamp to reset the clock",
  denied(() => deleteDoc(doc(throttleC.db, "orderThrottle", throttleUid))),
);
await t(
  "still refused 25 seconds after the last order",
  denied(async () => {
    await seedStamp(throttleUid, 25);
    await commitOrder(throttleC);
  }),
);
await t(
  "allowed again once 31 seconds have passed",
  allowed(async () => {
    await seedStamp(throttleUid, 31);
    await commitOrder(throttleC);
  }),
);
await t(
  "and refused again straight after that one",
  denied(() => commitOrder(throttleC)),
);
if (process.env.RULES_TEST_REAL_WAIT) {
  // The seeded tests above trust the emulator's clock arithmetic. This one
  // actually waits, for anyone who does not.
  console.log("        (waiting 31 s of real time...)");
  await new Promise((r) => setTimeout(r, 31_000));
  await t(
    "allowed after a real 31-second wait",
    allowed(() => commitOrder(throttleC)),
  );
}
await t(
  "an order with no throttle stamp is refused",
  denied(async () => {
    const { uid } = await freshCustomer(loner);
    await addDoc(collection(loner.db, "orders"), order({ customerUid: uid }));
  }),
);
await t(
  "a stamp naming a different order is refused",
  denied(async () => {
    await freshCustomer(loner);
    await commitOrder(loner, {}, { lastOrderId: "some-other-order" });
  }),
);
await t(
  "a backdated stamp is refused",
  denied(async () => {
    await freshCustomer(loner);
    await commitOrder(loner, {}, { lastOrderAt: new Date(2020, 0, 1) });
  }),
);
await t(
  "a stamp with an extra field is refused",
  denied(async () => {
    await freshCustomer(loner);
    await commitOrder(loner, {}, { lastOrderAt: serverTimestamp(), n: 1 });
  }),
);
await t(
  "one stamp cannot carry two orders in one batch",
  denied(async () => {
    const { uid } = await freshCustomer(loner);
    const a = doc(collection(loner.db, "orders"));
    const b = doc(collection(loner.db, "orders"));
    const batch = writeBatch(loner.db);
    batch.set(a, order({ customerUid: uid }));
    batch.set(b, order({ customerUid: uid }));
    batch.set(doc(loner.db, "orderThrottle", uid), {
      lastOrderAt: serverTimestamp(),
      lastOrderId: a.id,
    });
    await batch.commit();
  }),
);
await t(
  "cannot stamp another customer's throttle document",
  denied(async () => {
    await freshCustomer(loner);
    await setDoc(doc(loner.db, "orderThrottle", throttleUid), {
      lastOrderAt: serverTimestamp(),
      lastOrderId: "x",
    });
  }),
);
await t(
  "cannot read another customer's throttle stamp",
  denied(() => getDoc(doc(loner.db, "orderThrottle", throttleUid))),
);
await t(
  "a different customer is not held up by someone else's order",
  allowed(async () => {
    await freshCustomer(loner);
    await commitOrder(loner);
  }),
);

console.log("\n signed-in barista (no role document)");
// Each status assertion places its own order and then drives that document, so
// the result cannot depend on whatever state an earlier test left behind or on
// which document a query happens to return first.
const drive = (c) => async (o) => {
  const id = (await placeAs(publicC)).id;
  return setDoc(doc(c.db, "orders", id), o, { merge: true });
};
// Steps ONE order through the machine. drive() places a fresh order per call, so
// walking a chain with it would try to jump "preparing" straight to "served" on
// three different documents and fail for the right reason for the wrong reason.
const chain = (c) => {
  let id = null;
  return async (status) => {
    id ??= (await placeAs(publicC)).id;
    return setDoc(doc(c.db, "orders", id), { status }, { merge: true });
  };
};
await t(
  "an account with no role document is not staff",
  denied(() => getDocs(collection(staffC.db, "orders"))),
);
await t(
  "given a role document, the same account becomes staff",
  allowed(async () => {
    await fetch(
      `http://${HOST}:${FS_PORT}/v1/projects/${PROJECT}/databases/(default)/documents/staff/${staffAcct.localId}`,
      {
        method: "PATCH",
        headers: {
          Authorization: "Bearer owner",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ fields: { role: { stringValue: "staff" } } }),
      },
    );
    await getDocs(collection(staffC.db, "orders"));
  }),
);
await t(
  "a staff account can read the order board",
  allowed(() => getDocs(collection(staffC.db, "orders"))),
);
await t(
  "can advance preparing -> ready",
  allowed(() => drive(staffC)({ status: "ready" })),
);
await t(
  "can advance ready -> served",
  allowed(async () => {
    const step = chain(staffC);
    await step("ready");
    await step("served");
  }),
);
await t(
  "can advance served -> completed",
  allowed(async () => {
    const step = chain(staffC);
    await step("ready");
    await step("served");
    await step("completed");
  }),
);
await t(
  "cannot skip a state (preparing -> served)",
  denied(() => drive(staffC)({ status: "served" })),
);
await t(
  "cannot move an order backwards (served -> ready)",
  denied(async () => {
    const step = chain(staffC);
    await step("ready");
    await step("served");
    await step("ready");
  }),
);
await t(
  "cannot un-complete a finished order",
  denied(async () => {
    const step = chain(staffC);
    await step("ready");
    await step("served");
    await step("completed");
    await step("served");
  }),
);
await t(
  "cannot write meta/counters either",
  denied(() => setDoc(doc(staffC.db, "meta", "counters"), { orderNumber: 1 })),
);
await t(
  "cannot edit the menu (barista != owner)",
  denied(() =>
    addDoc(collection(staffC.db, "menu"), { name: "Hack", price: 0 }),
  ),
);
await t(
  "cannot add fields to a live order",
  denied(() => drive(staffC)({ gone: 1 })),
);
await t(
  "cannot edit the price on a live order",
  denied(() => drive(staffC)({ total: 1 })),
);
await t(
  "a barista cannot promote themselves to owner",
  denied(() =>
    setDoc(doc(staffC.db, "staff", staffAcct.localId), { role: "owner" }),
  ),
);

console.log("\n signed-in owner");
await t(
  "can write the menu",
  allowed(() =>
    addDoc(collection(ownerC.db, "menu"), { name: "Cortado", price: 150 }),
  ),
);
await t(
  "can read every staff record",
  allowed(() => getDocs(collection(ownerC.db, "staff"))),
);
await t(
  "can hand out the owner role",
  allowed(() =>
    setDoc(doc(ownerC.db, "staff", tempAcct.localId), { role: "owner" }),
  ),
);
await t(
  "a promoted user can then edit the menu",
  allowed(async () => {
    await signInWithEmailAndPassword(
      tempC.auth,
      "temp@cafe.test",
      "correct-horse",
    );
    await addDoc(collection(tempC.db, "menu"), { name: "Cortado", price: 150 });
  }),
);
await t(
  "a barista cannot promote themselves",
  denied(() =>
    setDoc(doc(staffC.db, "staff", staffAcct.localId), { role: "owner" }),
  ),
);

// The owner's table list (/admin/qr). Runs last so the barista already holds
// its staff role document: a staff account, not a stranger, is the refusal
// that matters here.
console.log("\n config/tables (the owner's table list)");
const tablesDoc = (c) => doc(c.db, "config", "tables");
await t(
  "the owner can save a table list",
  allowed(() =>
    setDoc(tablesDoc(ownerC), { tables: [1, 2, 3, 4, 5, 6, 7, 8] }),
  ),
);
await t(
  "the owner can save a list with gaps",
  allowed(() => setDoc(tablesDoc(ownerC), { tables: [1, 2, 3, 12, 14, 50] })),
);
await t(
  "anyone, signed out, can read it",
  allowed(() => getDoc(tablesDoc(nobodyC))),
);
await t(
  "a customer can read it",
  allowed(() => getDoc(tablesDoc(publicC))),
);
await t(
  "a barista cannot change it",
  denied(() => setDoc(tablesDoc(staffC), { tables: [1, 2] })),
);
await t(
  "a customer cannot change it",
  denied(() => setDoc(tablesDoc(publicC), { tables: [1, 2] })),
);
await t(
  "a signed-out caller cannot change it",
  denied(() => setDoc(tablesDoc(nobodyC), { tables: [1, 2] })),
);
await t(
  "a barista cannot delete it",
  denied(() => deleteDoc(tablesDoc(staffC))),
);
await t(
  "the owner cannot save an empty list",
  denied(() => setDoc(tablesDoc(ownerC), { tables: [] })),
);
await t(
  "the owner cannot save something that is not a list",
  denied(() => setDoc(tablesDoc(ownerC), { tables: "1,2,3" })),
);
await t(
  "the owner cannot save more than 50 tables",
  denied(() => setDoc(tablesDoc(ownerC), { tables: Array(51).fill(1) })),
);
await t(
  "the owner cannot save table 0",
  denied(() => setDoc(tablesDoc(ownerC), { tables: [0, 1, 2] })),
);
await t(
  "the owner cannot save a table above 50",
  denied(() => setDoc(tablesDoc(ownerC), { tables: [1, 2, 51] })),
);
await t(
  "the owner cannot save a fractional table",
  denied(() => setDoc(tablesDoc(ownerC), { tables: [1.5, 2] })),
);
await t(
  "the owner cannot save text for a table",
  denied(() => setDoc(tablesDoc(ownerC), { tables: ["1", 2] })),
);
await t(
  "the owner cannot add other fields",
  denied(() => setDoc(tablesDoc(ownerC), { tables: [1, 2], note: "x" })),
);
await t(
  "the owner cannot slip a field in with a merge",
  denied(() => setDoc(tablesDoc(ownerC), { note: "x" }, { merge: true })),
);
await t(
  "the owner can delete it, back to the default",
  allowed(() => deleteDoc(tablesDoc(ownerC))),
);
// The carve-out on /config/{docId} must not have cost the owner the special.
await t(
  "the owner can still save today's special",
  allowed(() =>
    setDoc(doc(ownerC.db, "config", "special"), { enabled: true, text: "Hi" }),
  ),
);
await t(
  "a barista still cannot save today's special",
  denied(() =>
    setDoc(doc(staffC.db, "config", "special"), { enabled: true, text: "x" }),
  ),
);

console.log(`\n${pass} passed, ${failures.length} failed`);
for (const f of failures) console.log(`  - ${f}`);
await Promise.all(
  [
    publicC.a,
    nobodyC.a,
    otherCustomerC.a,
    throttleC.a,
    loner.a,
    tempC.a,
    staffC.a,
    ownerC.a,
  ].map(deleteApp),
);
process.exit(failures.length ? 1 : 0);
