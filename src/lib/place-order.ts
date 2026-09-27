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

  const bundle = await loadBundle();

  return bundle.orders.create({
    tableNumber,
    items: check.lines,
    total: check.total,
    notes: notes?.trim() || undefined,
    paymentMethod,
  });
}
