/**
 * Storage contracts. Two implementations satisfy these — Firestore and the
 * localStorage demo store — which is what lets the app run with zero config
 * while still being production-shaped (see docs/decisions.md).
 */

import type {
  MenuItem,
  Order,
  OrderLine,
  SpecialOffer,
  Unsubscribe,
} from "../types";

export type Listener<T> = (value: T) => void;
export type ErrorListener = (error: Error) => void;

export interface NewOrderInput {
  tableNumber: number;
  items: OrderLine[];
  total: number;
  notes?: string;
  paymentMethod?: Order["paymentMethod"];
}

export interface MenuWriteInput {
  name: string;
  description?: string;
  price: number;
  category: string;
  available?: boolean;
  art?: string;
}

export interface MenuRepository {
  /** Live menu. Fires immediately with the current value. */
  subscribe(
    listener: Listener<MenuItem[]>,
    onError?: ErrorListener,
  ): Unsubscribe;
  list(): Promise<MenuItem[]>;
  create(input: MenuWriteInput): Promise<MenuItem>;
  update(id: string, patch: Partial<MenuWriteInput>): Promise<void>;
  remove(id: string): Promise<void>;
  /** Persist a whole new ordering (drag-to-reorder in /admin). */
  reorder(items: MenuItem[]): Promise<void>;
  /** Replace the menu wholesale (used by the seed button in demo mode). */
  replaceAll(items: MenuItem[]): Promise<void>;
}

export interface OrderRepository {
  /** Live active board: received/preparing/ready/served, oldest first. */
  subscribeActive(
    listener: Listener<Order[]>,
    onError?: ErrorListener,
  ): Unsubscribe;
  /** Live single order, for the customer's status screen. */
  subscribeOrder(
    id: string,
    listener: Listener<Order | null>,
    onError?: ErrorListener,
  ): Unsubscribe;
  create(input: NewOrderInput): Promise<Order>;
  setStatus(id: string, status: Order["status"]): Promise<void>;
  /**
   * Bounded range query — keeps Firestore reads inside the free tier.
   * Always returned oldest first. With `limit`, only the newest `limit` orders
   * in the range are read, so one busy month can't cost a day's read quota.
   */
  listRange(fromMs: number, toMs: number, limit?: number): Promise<Order[]>;
}

/**
 * `unassigned` is a real, signed-in Firebase account with no `/staff/{uid}`
 * document. The rules treat it as a stranger, so the app must too: it gets a
 * "not set up yet" screen rather than an order board it cannot read.
 */
export type StaffRole = "staff" | "owner" | "unassigned";

export interface StaffUser {
  uid: string;
  email: string;
  role: StaffRole;
  displayName: string;
}

export interface AuthRepository {
  /** Real Firebase Auth. `pin` is demo-mode only. */
  signIn(email: string, password: string): Promise<void>;
  signInWithPin(pin: string): Promise<void>;
  signOut(): Promise<void>;
  subscribe(listener: Listener<StaffUser | null>): Unsubscribe;
  current(): StaffUser | null;
}

export interface ConfigRepository {
  subscribe(listener: Listener<SpecialOffer>): Unsubscribe;
  save(offer: SpecialOffer): Promise<void>;
  /**
   * The owner's saved table list, or `null` while nothing has been saved (the
   * app then falls back to NEXT_PUBLIC_TABLES). Live, so a change on /admin/qr
   * reaches the customer's table picker without a redeploy.
   */
  subscribeTables(listener: Listener<number[] | null>): Unsubscribe;
  /** Rejects a list with no usable table rather than saving an empty cafe. */
  saveTables(tables: number[]): Promise<void>;
}

export interface DataBundle {
  menu: MenuRepository;
  orders: OrderRepository;
  auth: AuthRepository;
  config: ConfigRepository;
  /** True when backed by the localStorage demo store. */
  isDemo: boolean;
}
