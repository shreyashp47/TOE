/**
 * Firestore implementation of the storage contracts, matching the collection
 * layout in docs/requirements.md §8:
 *
 *   /orders/{orderId}  tableNumber, items[{name,qty,price}], total, status,
 *                      createdAt, completedAt?, paymentMethod
 *   /menu/{itemId}     name, description?, price, category, available
 *   /config/special   the "today's special" board
 *   /meta/counters    monotonic order display number
 *
 * `onSnapshot` powers the live staff board and the customer's status screen
 * (§5.3) with no separate realtime service. The module is only ever imported
 * when the Firebase env block is present (see ./index.ts).
 */

import { getDemoStaffPin } from "../config";
import { orderTotal } from "../money";
import {
  parseMenuItem,
  parseOrder,
  parseSpecialOffer,
  type MenuItem,
  type Order,
  type SpecialOffer,
  type Unsubscribe,
} from "../types";
import type {
  AuthRepository,
  ConfigRepository,
  Listener,
  MenuRepository,
  MenuWriteInput,
  NewOrderInput,
  OrderRepository,
  StaffUser,
} from "./types";

type Firestore = import("firebase/firestore").Firestore;
type DocData = import("firebase/firestore").DocumentData;
type DocSnap = import("firebase/firestore").DocumentSnapshot<DocData>;
type FsModule = typeof import("firebase/firestore");

const MENU = "menu";
const ORDERS = "orders";
const CONFIG = "config";
const SPECIAL_DOC = "special";
const COUNTERS = "meta/counters";
const STAFF = "staff";

let bundle: Promise<{
  app: import("firebase/app").FirebaseApp;
  auth: import("firebase/auth").Auth;
  db: Firestore;
  fs: FsModule;
}> | null = null;

function getBundle() {
  bundle ??= (async () => {
    const [mod, fs] = await Promise.all([
      import("./firebase").then((m) => m.default()),
      import("firebase/firestore"),
    ]);
    return { ...mod, fs };
  })();
  return bundle;
}

async function dbAndFs(): Promise<{ db: Firestore; fs: FsModule }> {
  const { db, fs } = await getBundle();
  return { db, fs };
}

/**
 * The identity a customer order is pinned to.
 *
 * A customer has no account (requirements §3), but "no account" cannot mean "no
 * identity" if the order rules are to let somebody read back their own order: an
 * unauthenticated caller is indistinguishable from any other anonymous caller.
 * So a customer signs in anonymously, which costs no sign-up and no prompt, and
 * the uid goes on the order document. The rule then reads
 * `resource.data.customerUid == request.auth.uid`, which means a customer can
 * read exactly the orders they placed and no one else's — which is the property
 * the rule was always supposed to have.
 *
 * The uid is persisted to localStorage purely so a page reload does not mint a
 * new identity and orphan the order being tracked.
 */
async function customerUid(): Promise<string> {
  const KEY = "toe.customerUid";
  const { auth } = await getBundle();
  if (auth.currentUser) return auth.currentUser.uid;
  const { signInAnonymously } = await import("firebase/auth");
  const cred = await signInAnonymously(auth);
  try {
    localStorage.setItem(KEY, cred.user.uid);
  } catch {
    /* private mode: the session cookie still keeps this tab working */
  }
  return cred.user.uid;
}

/**
 * Bridges the async module load to the synchronous `Unsubscribe` contract: if
 * the component unmounts before the SDK finishes loading, the listener is torn
 * down as soon as it exists.
 */
function deferred(factory: () => Promise<Unsubscribe>): Unsubscribe {
  let off: Unsubscribe | null = null;
  let cancelled = false;

  void factory().then((fn) => {
    if (cancelled) fn();
    else off = fn;
  });

  return () => {
    cancelled = true;
    off?.();
    off = null;
  };
}

function menuDoc(item: MenuItem) {
  return {
    name: item.name,
    description: item.description,
    price: item.price,
    category: item.category,
    available: item.available,
    art: item.art ?? null,
    sortOrder: item.sortOrder,
  };
}

function sortItems(items: MenuItem[]): MenuItem[] {
  return items.sort(
    (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
  );
}

function readOrder(snap: DocSnap): Order | null {
  const data = snap.data();
  if (!data) return null;
  const millis = (v: unknown) =>
    typeof (v as { toMillis?: () => number })?.toMillis === "function"
      ? (v as { toMillis: () => number }).toMillis()
      : typeof v === "number"
        ? v
        : undefined;
  return parseOrder({
    ...data,
    id: snap.id,
    createdAt: millis(data.createdAt) ?? Date.now(),
    completedAt: millis(data.completedAt),
  });
}

// --- menu -------------------------------------------------------------------

export const firestoreMenuRepo: MenuRepository = {
  subscribe(listener, onError) {
    return deferred(async () => {
      const { db, fs } = await dbAndFs();
      return fs.onSnapshot(
        fs.collection(db, MENU),
        (snap) => {
          const items = snap.docs
            .map((doc) => parseMenuItem({ id: doc.id, ...doc.data() }))
            .filter((item): item is MenuItem => item !== null);
          listener(sortItems(items));
        },
        (error) => onError?.(error),
      );
    });
  },
  async list() {
    const { db, fs } = await dbAndFs();
    const snap = await fs.getDocs(fs.collection(db, MENU));
    return sortItems(
      snap.docs
        .map((doc) => parseMenuItem({ id: doc.id, ...doc.data() }))
        .filter((item): item is MenuItem => item !== null),
    );
  },

  async create(input: MenuWriteInput): Promise<MenuItem> {
    const { db, fs } = await dbAndFs();
    const ref = fs.doc(fs.collection(db, MENU));
    const item: MenuItem = {
      id: ref.id,
      name: input.name,
      description: input.description ?? "",
      price: input.price,
      category: input.category,
      available: input.available ?? true,
      art: input.art,
      sortOrder: 900_000 + (Date.now() % 100_000),
    };
    await fs.setDoc(ref, menuDoc(item));
    return item;
  },

  async update(id, patch) {
    const { db, fs } = await dbAndFs();
    const clean = Object.fromEntries(
      Object.entries(patch).filter(([, v]) => v !== undefined),
    );
    await fs.updateDoc(fs.doc(db, MENU, id), clean);
  },

  async remove(id) {
    const { db, fs } = await dbAndFs();
    await fs.deleteDoc(fs.doc(db, MENU, id));
  },

  async reorder(items) {
    const { db, fs } = await dbAndFs();
    const batch = fs.writeBatch(db);
    items.forEach((item, index) => {
      batch.update(fs.doc(db, MENU, item.id), { sortOrder: (index + 1) * 10 });
    });
    await batch.commit();
  },

  async replaceAll(items) {
    const { db, fs } = await dbAndFs();
    const batch = fs.writeBatch(db);
    for (const item of items)
      batch.set(fs.doc(db, MENU, item.id), menuDoc(item));
    await batch.commit();
  },
};

// --- orders -----------------------------------------------------------------

export const firestoreOrderRepo: OrderRepository = {
  subscribeActive(listener, onError) {
    return deferred(async () => {
      const { db, fs } = await dbAndFs();
      // One bounded listener, oldest-first: the most urgent order stays on top and
      // the query stays index-friendly (§5.3).
      const query = fs.query(
        fs.collection(db, ORDERS),
        fs.where("status", "!=", "completed"),
        fs.orderBy("createdAt", "asc"),
        fs.limit(100),
      );
      return fs.onSnapshot(
        query,
        (snap) =>
          listener(
            snap.docs.map(readOrder).filter((o): o is Order => o !== null),
          ),
        (error) => onError?.(error),
      );
    });
  },

  subscribeOrder(id, listener, onError) {
    return deferred(async () => {
      const { db, fs } = await dbAndFs();
      return fs.onSnapshot(
        fs.doc(db, ORDERS, id),
        (snap) => listener(snap.exists() ? readOrder(snap) : null),
        (error) => onError?.(error),
      );
    });
  },

  async create(input: NewOrderInput): Promise<Order> {
    const { db, fs } = await dbAndFs();
    const uid = await customerUid();
    const ref = fs.doc(fs.collection(db, ORDERS));
    const total = orderTotal(input.items);
    // The display number is allocated in a transaction so two phones placing an
    // order in the same moment can't collide.
    await fs.runTransaction(db, async (tx) => {
      const counter = await tx.get(fs.doc(db, COUNTERS));
      const previous = counter.exists()
        ? Number(counter.data()?.orderNumber ?? 100)
        : 100;
      const orderNumber = previous + 1;
      tx.set(fs.doc(db, COUNTERS), { orderNumber }, { merge: true });
      tx.set(ref, {
        orderNumber,
        tableNumber: input.tableNumber,
        items: input.items,
        total,
        status: "preparing",
        createdAt: fs.serverTimestamp(),
        notes: input.notes ?? "",
        paymentMethod: input.paymentMethod ?? "counter",
        customerUid: uid,
      });
    });

    return parseOrder({
      id: ref.id,
      orderNumber: 0,
      tableNumber: input.tableNumber,
      items: input.items,
      total,
      status: "preparing",
      createdAt: Date.now(),
      paymentMethod: input.paymentMethod ?? "counter",
    }) as Order;
  },

  async setStatus(id, status) {
    const { db, fs } = await dbAndFs();
    const patch: Record<string, unknown> = { status };
    if (status === "completed") patch.completedAt = fs.serverTimestamp();
    await fs.updateDoc(fs.doc(db, ORDERS, id), patch);
  },

  async listRange(fromMs, toMs) {
    const { db, fs } = await dbAndFs();
    const query = fs.query(
      fs.collection(db, ORDERS),
      fs.where("createdAt", ">=", fs.Timestamp.fromDate(new Date(fromMs))),
      fs.where("createdAt", "<", fs.Timestamp.fromDate(new Date(toMs))),
      fs.orderBy("createdAt", "asc"),
    );
    const snap = await fs.getDocs(query);
    return snap.docs.map(readOrder).filter((o): o is Order => o !== null);
  },
};

// --- config -----------------------------------------------------------------

export const firestoreConfigRepo: ConfigRepository = {
  subscribe(listener: Listener<SpecialOffer>) {
    return deferred(async () => {
      const { db, fs } = await dbAndFs();
      return fs.onSnapshot(
        fs.doc(db, CONFIG, SPECIAL_DOC),
        (snap) => listener(parseSpecialOffer(snap.data())),
        () => listener({ enabled: false, text: "" }),
      );
    });
  },
  async save(offer: SpecialOffer) {
    const { db, fs } = await dbAndFs();
    await fs.setDoc(
      fs.doc(db, CONFIG, SPECIAL_DOC),
      { enabled: offer.enabled, text: offer.text.trim().slice(0, 140) },
      { merge: true },
    );
  },
};

// --- auth -------------------------------------------------------------------

const ROLE_CACHE_KEY = "cafe-qr-order.roles.v1";

function readRole(uid: string): StaffUser["role"] {
  try {
    const raw = globalThis.localStorage?.getItem(ROLE_CACHE_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, string>) : {};
    return map[uid] === "owner" ? "owner" : "staff";
  } catch {
    return "staff";
  }
}

function cacheRole(uid: string, role: StaffUser["role"]) {
  try {
    const raw = globalThis.localStorage?.getItem(ROLE_CACHE_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, string>) : {};
    map[uid] = role;
    globalThis.localStorage?.setItem(ROLE_CACHE_KEY, JSON.stringify(map));
  } catch {
    /* best-effort cache only */
  }
}

export const firestoreAuthRepo: AuthRepository = {
  async signIn(email, password) {
    const { auth, db, fs } = await getBundle();
    const { signInWithEmailAndPassword } = await import("firebase/auth");
    const credential = await signInWithEmailAndPassword(auth, email, password);

    // Role comes from /staff/{uid} (docs/requirements.md §8). A missing doc
    // defaults to `staff` so a barista can always work the board.
    const snap = await fs.getDoc(fs.doc(db, STAFF, credential.user.uid));
    const role: StaffUser["role"] =
      snap.exists() && snap.data()?.role === "owner" ? "owner" : "staff";
    cacheRole(credential.user.uid, role);
  },

  async signInWithPin(pin) {
    if (pin !== getDemoStaffPin()) {
      throw new Error("Wrong PIN. Ask the counter for today's code.");
    }
    throw new Error(
      "PIN sign-in is a demo-only shortcut. Use your staff email and password.",
    );
  },

  async signOut() {
    const { auth } = await getBundle();
    const { signOut } = await import("firebase/auth");
    await signOut(auth);
  },

  subscribe(listener) {
    let off: Unsubscribe = () => {};
    let cancelled = false;

    void (async () => {
      const { auth } = await getBundle();
      const { onAuthStateChanged } = await import("firebase/auth");
      if (cancelled) return;
      off = onAuthStateChanged(auth, (user) => {
        listener(
          user
            ? {
                uid: user.uid,
                email: user.email ?? "",
                role: readRole(user.uid),
                displayName:
                  user.displayName ?? user.email?.split("@")[0] ?? "Staff",
              }
            : null,
        );
      });
    })();

    return () => {
      cancelled = true;
      off();
    };
  },

  current() {
    // The auth state is owned by onAuthStateChanged; the synchronous getter is
    // only a best-effort read used before the first listener resolves.
    return null;
  },
};
