/**
 * Open tables: staff confirm new guests before their order reaches the kitchen.
 *
 * The problem. A table's QR link (with its code) works for anyone who has it:
 * a guest from last week, someone who photographed the card. Nothing about a
 * static site on the free plan can tell "at table 4" from "at home with a
 * photo of table 4's card". A person at the counter can, by looking.
 *
 * The fix. Each table is either open or closed, stored as
 * `tableSessions/{n} = { openUntil }` (a time; the table is open while it is in
 * the future). An order from an open table goes straight to the kitchen as
 * `preparing`. An order from a closed table arrives as `pending`, in its own
 * "New guests — check the table" section of the board; staff glance at the
 * table and tap Accept, which moves the order to `preparing` and opens the
 * table for TABLE_OPEN_HOURS, so the group's next orders skip the wait.
 *
 * Tables close on their own: nothing is written, `openUntil` simply passes.
 * It is pushed forward (never back) whenever staff accept an order or move an
 * order of that table to ready or served while the table is open — so a table
 * stays open for TABLE_OPEN_HOURS after the last thing staff did for it.
 * Completing or rejecting an order does not extend it (completing is usually
 * the group paying and leaving), and neither does anything on a table that has
 * already closed, so "Close table" really closes it. Staff can close one early.
 *
 * firestore.rules enforces the split: `pending` is always allowed, `preparing`
 * only while tableSessions/{n}.openUntil > request.time (or when the owner has
 * switched confirmation off in config/ordering). The phone reads both first
 * and picks the status the rules will take; see chooseOrderStatus.
 */

import type { NewOrderStatus } from "./order-status";

/** How long Accept opens a table for. */
export const TABLE_OPEN_HOURS = 3;
export const TABLE_OPEN_MS = TABLE_OPEN_HOURS * 60 * 60_000;

/**
 * The furthest ahead firestore.rules lets staff set `openUntil`, measured from
 * the server's clock. One hour more than TABLE_OPEN_HOURS, so a counter tablet
 * whose clock runs a little fast can still open a table.
 */
export const MAX_OPEN_HOURS = 4;

/** table number -> openUntil (ms since epoch). Missing = closed. */
export type TableSessions = Record<number, number>;

export interface OrderingSettings {
  /**
   * Orders from a table staff have not confirmed wait as `pending`. ON unless
   * the owner has switched it off: the protection is the default, and a cafe
   * that has never visited the setting has it.
   */
  confirmNewGuests: boolean;
}

export const DEFAULT_ORDERING: OrderingSettings = { confirmNewGuests: true };

/** config/ordering as stored. Anything unreadable means the default (ON). */
export function parseOrderingSettings(raw: unknown): OrderingSettings {
  const value =
    raw && typeof raw === "object"
      ? (raw as { confirmNewGuests?: unknown }).confirmNewGuests
      : undefined;
  return {
    confirmNewGuests: typeof value === "boolean" ? value : true,
  };
}

export function isTableOpen(
  sessions: TableSessions,
  table: number,
  now: number,
): boolean {
  const until = sessions[table];
  return typeof until === "number" && until > now;
}

/** Open tables, lowest number first, with what is left of each. */
export function openTables(
  sessions: TableSessions,
  now: number,
): Array<{ table: number; openUntil: number; msLeft: number }> {
  return Object.entries(sessions)
    .map(([t, openUntil]) => ({
      table: Number(t),
      openUntil,
      msLeft: openUntil - now,
    }))
    .filter((s) => Number.isInteger(s.table) && s.msLeft > 0)
    .sort((a, b) => a.table - b.table);
}

/** "2h 41m left", "12m left", "under a minute left". */
export function formatTimeLeft(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "under a minute left";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m left`;
  return m === 0 ? `${h}h left` : `${h}h ${m}m left`;
}

/**
 * The status a new order should be created in. `preparing` only when the
 * rules will take it: confirmation is off, or the table is open.
 */
export function chooseOrderStatus({
  confirmNewGuests,
  tableOpen,
}: {
  confirmNewGuests: boolean;
  tableOpen: boolean;
}): NewOrderStatus {
  return !confirmNewGuests || tableOpen ? "preparing" : "pending";
}

/** Where Accept (or keeping a table open) sets `openUntil`. Never earlier. */
export function extendedOpenUntil(current: number | undefined, now: number) {
  return Math.max(current ?? 0, now + TABLE_OPEN_MS);
}

/** Only these staff steps keep an open table open. See the module comment. */
export function keepsTableOpen(to: string): boolean {
  return to === "preparing" || to === "ready" || to === "served";
}

export function parseTableSessionsDoc(
  table: string | number,
  raw: unknown,
): [number, number] | null {
  const n = Number(table);
  if (!Number.isInteger(n) || n < 1 || n > 50) return null;
  const until =
    raw && typeof raw === "object"
      ? (raw as { openUntil?: unknown }).openUntil
      : undefined;
  const ms =
    typeof until === "number"
      ? until
      : typeof (until as { toMillis?: () => number })?.toMillis === "function"
        ? (until as { toMillis: () => number }).toMillis()
        : null;
  return ms !== null && Number.isFinite(ms) ? [n, ms] : null;
}
