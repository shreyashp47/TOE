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
 */
import { initializeApp, deleteApp } from "firebase/app";
import {
  connectAuthEmulator,
  getAuth,
  signInWithEmailAndPassword,
} from "firebase/auth";
import {
  connectFirestoreEmulator,
  getFirestore,
  collection,
  doc,
  addDoc,
  setDoc,
  getDocs,
  serverTimestamp,
} from "firebase/firestore";

const PROJECT = process.env.FIRESTORE_EMULATOR_PROJECT ?? "demo-cafe";
const HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1";
const FS_PORT = Number(process.env.FIRESTORE_EMULATOR_PORT ?? 8080);
const AUTH_PORT = Number(process.env.FIREBASE_AUTH_EMULATOR_PORT ?? 9099);
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
const denied = (fn) => async () => {
  try {
    await fn();
  } catch {
    return;
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
const signup = (email) =>
  fetch(`${AUTH_BASE}/accounts:signUp?key=demo`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      password: "correct-horse",
      returnSecureToken: true,
    }),
  }).then((r) => r.json());

const ownerAcct = await signup("owner@cafe.test");
const staffAcct = await signup("staff@cafe.test");
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

const line = (o = {}) => ({ name: "Espresso", qty: 2, price: 120, ...o });
const order = (o = {}) => ({
  orderNumber: 101,
  tableNumber: 3,
  items: [line()],
  total: 240,
  status: "preparing",
  createdAt: serverTimestamp(),
  notes: "",
  paymentMethod: "counter",
  ...o,
});
const addOrder = (o) => addDoc(collection(publicC.db, "orders"), order(o));
const firstOrderId = async (c) =>
  (await getDocs(collection(c, "orders"))).docs[0].id;

console.log(`\nfirestore.rules vs the emulators (${PROJECT})\n`);
console.log(" anonymous customer");
await t(
  "can place a valid order",
  allowed(() => addOrder()),
);
await t(
  "cannot set status=completed",
  denied(() => addOrder({ status: "completed" })),
);
await t(
  "cannot send total as a string",
  denied(() => addOrder({ total: "240" })),
);
await t(
  "cannot send a negative total",
  denied(() => addOrder({ total: -500 })),
);
await t(
  "cannot inject an extra field",
  denied(() => addOrder({ completedAt: serverTimestamp() })),
);
await t(
  "cannot send an empty basket",
  denied(() => addOrder({ items: [] })),
);
await t(
  "cannot send 51 line items",
  denied(() => addOrder({ items: Array(51).fill(line()) })),
);
await t(
  "cannot use tableNumber 0",
  denied(() => addOrder({ tableNumber: 0 })),
);
await t(
  "cannot invent a payment method",
  denied(() => addOrder({ paymentMethod: "wire" })),
);
await t(
  "cannot backdate createdAt",
  denied(() => addOrder({ createdAt: new Date(2020, 0, 1) })),
);
await t(
  "cannot set qty 0 on a line",
  denied(() => addOrder({ items: [line({ qty: 0 })] })),
);
await t(
  "cannot set an absurd unit price",
  denied(() => addOrder({ items: [line({ price: 999999 })] })),
);
await t(
  "cannot read the order book",
  denied(() => getDocs(collection(publicC.db, "orders"))),
);
await t(
  "cannot rewrite a placed order",
  denied(async () => {
    await setDoc(
      doc(publicC.db, "orders", await firstOrderId(publicC.db)),
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

console.log("\n signed-in barista (no role document)");
await t(
  "can read the order board",
  allowed(() => getDocs(collection(staffC.db, "orders"))),
);
await t(
  "can advance preparing -> ready",
  allowed(async () => {
    await setDoc(
      doc(staffC.db, "orders", await firstOrderId(staffC.db)),
      { status: "ready" },
      { merge: true },
    );
  }),
);
await t(
  "can advance ready -> served",
  allowed(async () => {
    await setDoc(
      doc(staffC.db, "orders", await firstOrderId(staffC.db)),
      { status: "served" },
      { merge: true },
    );
  }),
);
await t(
  "can advance served -> completed",
  allowed(async () => {
    await setDoc(
      doc(staffC.db, "orders", await firstOrderId(staffC.db)),
      { status: "completed" },
      { merge: true },
    );
  }),
);
await t(
  "cannot skip a state (served -> ready)",
  denied(async () => {
    await setDoc(
      doc(staffC.db, "orders", await firstOrderId(staffC.db)),
      { status: "ready" },
      { merge: true },
    );
  }),
);
await t(
  "cannot edit the menu (barista != owner)",
  denied(() =>
    addDoc(collection(staffC.db, "menu"), { name: "Hack", price: 0 }),
  ),
);
await t(
  "cannot add fields to a live order",
  denied(async () => {
    await setDoc(
      doc(staffC.db, "orders", await firstOrderId(staffC.db)),
      { gone: 1 },
      { merge: true },
    );
  }),
);
await t(
  "cannot edit the price on a live order",
  denied(async () => {
    await setDoc(
      doc(staffC.db, "orders", await firstOrderId(staffC.db)),
      { total: 1 },
      { merge: true },
    );
  }),
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
    setDoc(doc(ownerC.db, "staff", staffAcct.localId), { role: "owner" }),
  ),
);

console.log(`\n${pass} passed, ${failures.length} failed`);
for (const f of failures) console.log(`  - ${f}`);
await Promise.all([publicC.a, staffC.a, ownerC.a].map(deleteApp));
process.exit(failures.length ? 1 : 0);
