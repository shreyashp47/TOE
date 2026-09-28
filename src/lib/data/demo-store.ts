/**
 * Demo storage backend.
 *
 * Zero-config, browser-local, and — importantly — still *live*: writes are
 * broadcast to every other tab on the same origin, so opening `/order?table=3`
 * and `/staff` side by side on one laptop behaves like the real thing. This is
 * how the app is demoed before a Firebase project exists.
 *
 * Everything lives under a single localStorage key so a write is atomic and the
 * two-tab sync can't interleave a half-written state.
 */

import {
  DEFAULT_STATUS,
  MAX_REJECT_REASON,
  canReject,
  isActiveStatus,
} from "../order-status";
import { orderTotal } from "../money";
import { orderCapProblems } from "../order-caps";
import { isTableKey, type TableKeys } from "../table-keys";
import { displayNumberFromId } from "../order-number";
import {
  parseMenuList,
  parseOrder,
  parseOrderList,
  parseSpecialOffer,
  type MenuItem,
  type Order,
  type SpecialOffer,
  type Unsubscribe,
} from "../types";
import { normalizeTables } from "../tables";
import { SEED_MENU, SEED_OFFER } from "./seed";
import type { NewOrderInput } from "./types";

export const DEMO_STORAGE_KEY = "cafe-qr-order.demo.v1";
const SYNC_EVENT = "cafe-qr-order:sync";

interface DemoState {
  menu: MenuItem[];
  orders: Order[];
  offer: SpecialOffer;
  /** null until the owner saves a list: the env default applies meanwhile. */
  tables: number[] | null;
  /** The owner's per-table QR codes (tableKeys/{n} in Firestore). */
  tableKeys: Record<number, string>;
}

function emptyState(): DemoState {
  return {
    menu: [],
    orders: [],
    offer: { enabled: false, text: "" },
    tables: null,
    tableKeys: {},
  };
}

function seedState(): DemoState {
  return {
    menu: SEED_MENU.map((item) => ({ ...item })),
    orders: [],
    offer: { ...SEED_OFFER },
    tables: null,
    tableKeys: {},
  };
}

/** Stable ids without pulling in a uuid dependency. */
export function makeId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}${rand}`;
}

// --- storage plumbing -------------------------------------------------------

function safeStorage(): Storage | null {
  try {
    if (typeof globalThis === "undefined" || !("localStorage" in globalThis)) {
      return null;
    }
    const probe = "__cafe_probe__";
    globalThis.localStorage.setItem(probe, "1");
    globalThis.localStorage.removeItem(probe);
    return globalThis.localStorage;
  } catch {
    // Safari private mode / disabled storage: fall back to memory only.
    return null;
  }
}

let storage: Storage | null | undefined;
function getStorage(): Storage | null {
  if (storage === undefined) storage = safeStorage();
  return storage;
}

let memoryState: DemoState | null = null;

function load(): DemoState {
  const store = getStorage();
  if (!store) {
    memoryState ??= seedState();
    return memoryState;
  }
  const raw = store.getItem(DEMO_STORAGE_KEY);
  if (!raw) {
    const seeded = seedState();
    store.setItem(DEMO_STORAGE_KEY, JSON.stringify(seeded));
    return seeded;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return {
      menu: parseMenuList((parsed as DemoState)?.menu),
      orders: parseOrderList((parsed as DemoState)?.orders),
      offer: parseSpecialOffer((parsed as DemoState)?.offer),
      // Saved states from before editable tables have no such field, which
      // reads as "nothing saved", exactly like a fresh Firestore project.
      tables: normalizeTables((parsed as DemoState)?.tables),
      // States from before table codes have none: every table is open, which
      // is the same transition a live cafe goes through.
      tableKeys: parseTableKeys((parsed as DemoState)?.tableKeys),
      // Older saved states also carry a `seq` counter. It is ignored: the display
      // number is derived from the id now, exactly as it is in Firestore.
    };
  } catch {
    return seedState();
  }
}

type Listener = (state: DemoState) => void;
const listeners = new Set<Listener>();
let channel: BroadcastChannel | null | undefined;

function getChannel(): BroadcastChannel | null {
  if (channel === undefined) {
    channel = null;
    try {
      if (typeof BroadcastChannel === "function") {
        channel = new BroadcastChannel(SYNC_EVENT);
        channel.onmessage = () => emit();
      }
    } catch {
      channel = null;
    }
  }
  return channel;
}

function emit() {
  const state = load();
  for (const listener of listeners) listener(state);
}

function commit(next: DemoState, broadcast = true) {
  const store = getStorage();
  if (store) {
    try {
      store.setItem(DEMO_STORAGE_KEY, JSON.stringify(next));
    } catch {
      memoryState = next;
    }
  } else {
    memoryState = next;
  }
  emit();
  if (broadcast) {
    try {
      getChannel()?.postMessage("changed");
    } catch {
      /* channel closed */
    }
  }
}

function mutate(fn: (state: DemoState) => DemoState) {
  commit(fn(load()));
}

function subscribeState(listener: Listener): Unsubscribe {
  getChannel();
  listeners.add(listener);
  listener(load());
  return () => {
    listeners.delete(listener);
  };
}

/** Used by tests: drop all state and listeners. */
export function resetDemoStore() {
  listeners.clear();
  memoryState = null;
  const store = getStorage();
  store?.removeItem(DEMO_STORAGE_KEY);
}

// --- selectors --------------------------------------------------------------

export function selectMenu(state: DemoState): MenuItem[] {
  return [...state.menu].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
  );
}

/** Active board ordering: oldest first, so the most urgent order is on top. */
export function selectActiveOrders(state: DemoState): Order[] {
  return state.orders
    .filter((o) => isActiveStatus(o.status))
    .sort((a, b) => a.createdAt - b.createdAt || a.orderNumber - b.orderNumber);
}

export function selectOrder(state: DemoState, id: string): Order | null {
  return state.orders.find((o) => o.id === id) ?? null;
}

export function selectOffer(state: DemoState): SpecialOffer {
  return state.offer;
}

export function selectTables(state: DemoState): number[] | null {
  return state.tables;
}

export function selectTableKeys(state: DemoState): TableKeys {
  return state.tableKeys;
}

function parseTableKeys(raw: unknown): Record<number, string> {
  const out: Record<number, string> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [table, key] of Object.entries(raw)) {
    const n = Number(table);
    if (Number.isInteger(n) && n >= 1 && n <= 50 && isTableKey(key))
      out[n] = key;
  }
  return out;
}

/**
 * What firestore.rules says to an order, so the demo refuses the same orders the
 * live app does and the phone goes down the same error path. Firestore reports
 * every refusal as a bare "permission-denied", and so does this.
 */
export class DemoRulesRefusal extends Error {
  readonly code = "permission-denied";
  constructor(why: string) {
    super(`Missing or insufficient permissions. (demo: ${why})`);
    this.name = "DemoRulesRefusal";
  }
}

/** Inclusive of `from`, exclusive of `to` — matches the reports' month range. */
export function selectOrdersInRange(
  state: DemoState,
  fromMs: number,
  toMs: number,
): Order[] {
  return state.orders
    .filter((o) => o.createdAt >= fromMs && o.createdAt < toMs)
    .sort((a, b) => a.createdAt - b.createdAt);
}

// --- commands ---------------------------------------------------------------

/**
 * No counter here either. The display number comes from the id, the same way
 * the Firestore adapter does it (src/lib/order-number.ts), so the demo cannot
 * quietly promise sequential numbers that the real backend does not give.
 */
export function demoCreateOrder(input: NewOrderInput): Order {
  const now = Date.now();
  const state = load();
  // Mirrors the order create rule: a table with a code needs that code.
  const expected = state.tableKeys[input.tableNumber];
  if (expected && input.tableKey !== expected) {
    throw new DemoRulesRefusal("wrong or missing table code");
  }
  if (orderCapProblems(input.items, orderTotal(input.items)).length > 0) {
    throw new DemoRulesRefusal("order over the size limits");
  }
  const order = parseOrder({
    id: makeId("o"),
    tableNumber: input.tableNumber,
    items: input.items,
    total: orderTotal(input.items),
    status: DEFAULT_STATUS,
    createdAt: now,
    notes: input.notes,
    paymentMethod: input.paymentMethod ?? "counter",
  });
  if (!order) {
    throw new Error("Could not build the order from the cart.");
  }

  mutate((state) => ({ ...state, orders: [...state.orders, order] }));

  return order;
}

export function demoSetStatus(id: string, status: Order["status"]): void {
  mutate((state) => ({
    ...state,
    orders: state.orders.map((order) =>
      order.id === id
        ? {
            ...order,
            status,
            ...(status === "completed" ? { completedAt: Date.now() } : {}),
          }
        : order,
    ),
  }));
}

/** Mirrors the `rejected` branch of the order update rule. */
export function demoRejectOrder(id: string, reason?: string): void {
  const order = load().orders.find((o) => o.id === id);
  if (!order || !canReject(order.status)) {
    throw new DemoRulesRefusal("that order can no longer be rejected");
  }
  const clean = reason?.trim().slice(0, MAX_REJECT_REASON);
  mutate((state) => ({
    ...state,
    orders: state.orders.map((o) =>
      o.id === id
        ? {
            ...o,
            status: "rejected" as const,
            ...(clean ? { rejectReason: clean } : {}),
          }
        : o,
    ),
  }));
}

export function demoSaveTableKeys(keys: TableKeys): void {
  for (const [table, key] of Object.entries(keys)) {
    const n = Number(table);
    if (!Number.isInteger(n) || n < 1 || n > 50 || !isTableKey(key)) {
      throw new DemoRulesRefusal("bad table code");
    }
  }
  mutate((state) => ({
    ...state,
    tableKeys: { ...state.tableKeys, ...keys },
  }));
}

export function demoWriteMenu(
  id: string,
  patch: Partial<Omit<MenuItem, "id">>,
): void {
  mutate((state) => ({
    ...state,
    menu: state.menu.map((item) =>
      item.id === id ? { ...item, ...patch } : item,
    ),
  }));
}

export function demoCreateMenu(
  input: Omit<MenuItem, "id" | "sortOrder"> & { sortOrder?: number },
): MenuItem {
  const item: MenuItem = {
    ...input,
    id: makeId("m"),
    description: input.description ?? "",
    available: input.available ?? true,
    sortOrder: input.sortOrder ?? 1000,
  };
  mutate((state) => ({ ...state, menu: [...state.menu, item] }));
  return item;
}

export function demoDeleteMenu(id: string): void {
  mutate((state) => ({
    ...state,
    menu: state.menu.filter((item) => item.id !== id),
  }));
}

export function demoReplaceMenu(items: MenuItem[]): void {
  mutate((state) => ({ ...state, menu: items }));
}

/**
 * Replaces the order history with a sample month (demo mode only). Used by the
 * "Add a sample month" button so the reports page can be evaluated before there
 * is real data to look at.
 */
export function demoSeedOrders(
  orders: Array<Omit<Order, "id" | "orderNumber">>,
): number {
  mutate((state) => {
    const withIds = orders.map((order) => {
      const id = makeId("o");
      return { ...order, id, orderNumber: displayNumberFromId(id) };
    });
    return { ...state, orders: withIds };
  });
  return orders.length;
}

export function demoSaveOffer(offer: SpecialOffer): void {
  mutate((state) => ({ ...state, offer }));
}

export function demoSaveTables(tables: number[]): void {
  mutate((state) => ({ ...state, tables }));
}

export { subscribeState, load as loadDemoState, emptyState, seedState };
