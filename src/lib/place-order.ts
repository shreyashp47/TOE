/**
 * Placing an order.
 *
 * The customer phone is untrusted, so this re-prices the basket against the
 * live menu immediately before writing (issue #4: "total is computed from
 * server-side-authoritative prices at order time, not just the client copy"),
 * and refuses to send a basket containing a sold-out or deleted item.
 */

import { loadBundle } from "./data";
import { priceCart } from "./money";
import {
  OrderThrottled,
  readLastOrderAt,
  recordOrderPlaced,
  secondsUntilNextOrder,
} from "./order-throttle";
import type { CartLine, MenuItem, Order } from "./types";

export interface PlaceOrderArgs {
  tableNumber: number;
  cartLines: CartLine[];
  menu: MenuItem[];
  notes?: string;
  paymentMethod?: Order["paymentMethod"];
}

export class OrderRejected extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(problems.join(" "));
    this.name = "OrderRejected";
    this.problems = problems;
  }
}

export async function placeOrder({
  tableNumber,
  cartLines,
  menu,
  notes,
  paymentMethod = "counter",
}: PlaceOrderArgs): Promise<Order> {
  if (!Number.isInteger(tableNumber) || tableNumber < 1) {
    throw new Error("We lost track of your table. Please scan again.");
  }
  if (cartLines.length === 0) {
    throw new Error("Your order is empty.");
  }

  // Re-price from the freshest menu we have. In demo mode `menu` is the live
  // subscription value, so this is the same data the staff board sees.
  // A price change is not fatal — the customer is charged the new price, which
  // the checkout button already displayed. A sold-out or deleted item is.
  const check = priceCart(cartLines, menu);
  if (check.blocking.length > 0) {
    throw new OrderRejected(check.blocking);
  }

  // One order per customer per ORDER_GAP_SECONDS (issue #32). The rules enforce
  // it; this just tells an honest customer how long to wait, instead of letting
  // the server's bare permission-denied become "we couldn't send that".
  const wait = secondsUntilNextOrder(readLastOrderAt(), Date.now());
  if (wait > 0) throw new OrderThrottled(wait);

  const bundle = await loadBundle();

  try {
    const order = await bundle.orders.create({
      tableNumber,
      items: check.lines,
      total: check.total,
      notes: notes?.trim() || undefined,
      paymentMethod,
    });
    recordOrderPlaced(Date.now());
    return order;
  } catch (err) {
    if (err instanceof OrderThrottled) throw err;
    throw new Error(friendlyError(err));
  }
}

/**
 * Turns a backend failure into something a person at table 4 can act on.
 *
 * The alternative is what this did before: the raw Firebase string. "Firebase:
 * Error (auth/configuration-not-found)" in the middle of a checkout tells a
 * customer nothing and tells the cafe owner nothing except that the order was
 * lost. The one that matters most here is the not-configured case, because it
 * looks like a broken app rather than a half-finished setup step.
 */
export function friendlyError(err: unknown): string {
  const raw =
    err instanceof Error ? err.message : typeof err === "string" ? err : "";
  const code = /\(([a-z0-9/-]+)\)/i.exec(raw)?.[1] ?? "";

  if (code.startsWith("auth/")) {
    if (code.includes("configuration-not-found"))
      return "Ordering is not switched on yet. Please tell the counter.";
    if (code.includes("network"))
      return "No connection right now. Check the wifi and try again.";
    if (code.includes("blocked"))
      return "This device is not allowed to order. Please scan the code again.";
    if (code.includes("unauthorized-domain"))
      return "Ordering is not switched on for this address. Please tell the counter.";
    return "We couldn't confirm who you are. Please tell the counter.";
  }
  if (code.startsWith("permission-denied"))
    return "We couldn't send that order. Please tell the counter.";
  if (code.startsWith("unavailable"))
    return "The kitchen system is busy. Please try again in a moment.";
  if (code.startsWith("deadline-exceeded"))
    return "That took too long. Please try again.";
  if (raw.trim()) return raw;
  return "We couldn't send that. Please try again.";
}
