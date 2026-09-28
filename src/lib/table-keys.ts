/**
 * Per-table secret codes: what stops an order from anywhere but the table.
 *
 * Ordering is pay-at-the-counter, and the order page used to need nothing but a
 * table number, so anyone who had ever seen the address could order for table 2
 * from home by typing `/order?table=2`. The cost is prank and wasted orders, not
 * lost money, but it is real.
 *
 * So each table gets a random code, stored in Firestore at `tableKeys/{table}`
 * (owner-only: customers and staff can never read one), and printed into that
 * table's QR code as `/order?table=2&k=CODE`. The order rule in firestore.rules
 * refuses an order for a table that has a code unless the order carries it.
 *
 * What it does not do: a photo of the QR code still works from anywhere, until
 * the owner presses "New code" for that table and reprints the card. It raises
 * the bar from "knows the address" to "has been at the table". See
 * docs/decisions.md.
 *
 * Transition: a table with no code yet takes orders without one, exactly as
 * before, so deploying this changes nothing until the owner presses "Create
 * codes" on /admin/qr and puts the new cards out.
 */

/** Length of a new code. 62^12 is about 3 * 10^21: not guessable by retrying. */
export const TABLE_KEY_LENGTH = 12;
/** Bounds firestore.rules accepts, for both the stored code and the order field. */
export const MIN_TABLE_KEY_LENGTH = 10;
export const MAX_TABLE_KEY_LENGTH = 64;

const ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** table number -> code, for the tables that have one. */
export type TableKeys = Readonly<Record<number, string>>;

/**
 * A fresh random code, base62. Uses the platform CSPRNG, never Math.random: the
 * code is the whole protection, so it must not be predictable from another one.
 * Bytes of 248 and over are thrown away rather than folded in with `% 62`, which
 * would make the first eight characters of the alphabet slightly likelier.
 */
export function generateTableKey(
  length: number = TABLE_KEY_LENGTH,
  fill: (bytes: Uint8Array) => Uint8Array = (b) =>
    globalThis.crypto.getRandomValues(b),
): string {
  const limit = 256 - (256 % ALPHABET.length); // 248
  let out = "";
  while (out.length < length) {
    for (const byte of fill(new Uint8Array(length * 2))) {
      if (byte >= limit) continue;
      out += ALPHABET[byte % ALPHABET.length];
      if (out.length === length) break;
    }
  }
  return out;
}

/** The shape a code can have. Anything else in `?k=` is ignored. */
export function isTableKey(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= MIN_TABLE_KEY_LENGTH &&
    value.length <= MAX_TABLE_KEY_LENGTH &&
    /^[A-Za-z0-9]+$/.test(value)
  );
}

/** Tables in `tables` that have no code yet, in order. */
export function tablesWithoutKey(
  tables: readonly number[],
  keys: TableKeys,
): number[] {
  return tables.filter((n) => !isTableKey(keys[n]));
}

// --- the customer's phone ------------------------------------------------------

const PREFIX = "toe.tableKey.t";
// Private browsing can refuse storage outright. The code then only lives for
// this page load, which still covers scan -> order -> confirmation.
const memory = new Map<number, string>();

/**
 * Remember the code a customer arrived with, per table, so a reload, the
 * confirmation page's "Back to the menu" and "Order again" keep working without
 * the code in the address. A newer scan always replaces it, which is how a
 * renewed code reaches a phone that had the old one.
 */
export function rememberTableKey(tableNumber: number, key: string): void {
  if (!isTableKey(key)) return;
  memory.set(tableNumber, key);
  try {
    globalThis.localStorage?.setItem(`${PREFIX}${tableNumber}`, key);
  } catch {
    /* memory copy above still covers this visit */
  }
}

export function readTableKey(tableNumber: number): string | null {
  try {
    const stored = globalThis.localStorage?.getItem(`${PREFIX}${tableNumber}`);
    if (isTableKey(stored)) return stored;
  } catch {
    /* fall through to memory */
  }
  return memory.get(tableNumber) ?? null;
}

/** Used by tests. */
export function forgetTableKeys(): void {
  memory.clear();
  try {
    const store = globalThis.localStorage;
    if (!store) return;
    for (let i = store.length - 1; i >= 0; i -= 1) {
      const k = store.key(i);
      if (k?.startsWith(PREFIX)) store.removeItem(k);
    }
  } catch {
    /* nothing to forget */
  }
}
