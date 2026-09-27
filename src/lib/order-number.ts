/**
 * The short number a barista reads out ("table four, number 417").
 *
 * It used to come from a shared counter at /meta/counters that every customer
 * phone incremented in a transaction. That counter had to be publicly writable
 * for the customer to bump it, so anyone could reset it, push it to 999999, or
 * hammer it to burn free-tier writes (issue #30). It also cost a read per order
 * for a value that is only decorative.
 *
 * So the number is now derived from the order's document id instead. Firestore
 * auto ids are 20 random characters, so a hash of the id is effectively a random
 * three-digit number, and deriving it on read means nothing needs to be written,
 * nothing needs to be shared, and there is nothing for a stranger to tamper with.
 *
 * The trade-off, stated plainly: three digits is not unique. Two orders in a day
 * can share a number. That is why the number is never shown on its own — the
 * staff board and the customer's screen both lead with the table, and two open
 * orders on the same table with the same number is roughly a 1-in-900 event per
 * pair. Three digits was chosen over four because it is what gets said out loud
 * across a counter; the table does the disambiguating.
 *
 * Orders placed before this change carry a stored `orderNumber` from the old
 * counter. That stored value wins, so old receipts and reports do not renumber.
 */

export const DISPLAY_NUMBER_MIN = 100;
export const DISPLAY_NUMBER_MAX = 999;
const SPAN = DISPLAY_NUMBER_MAX - DISPLAY_NUMBER_MIN + 1;

/**
 * FNV-1a (32-bit) over the id, folded into 100–999. Deterministic, so every
 * device that reads the same document shows the same number, and there is no
 * dependency to ship to the customer's phone for it.
 */
export function displayNumberFromId(id: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return DISPLAY_NUMBER_MIN + (hash % SPAN);
}

/**
 * The number to show for an order: the stored one if the document predates the
 * derived scheme, otherwise the one derived from the id.
 */
export function resolveOrderNumber(id: string, stored: unknown): number {
  if (typeof stored === "number" && Number.isInteger(stored) && stored > 0) {
    return stored;
  }
  return displayNumberFromId(id);
}
