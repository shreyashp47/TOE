import { beforeEach, describe, expect, it } from "vitest";

import { getDemoStaffPin, getTableNumbers, isDemoMode } from "@/lib/config";
import { OrderRejected, placeOrder } from "@/lib/place-order";
import {
  forgetSessionOrder,
  readSessionOrderId,
  rememberSessionOrder,
} from "@/lib/order-session";
import { orderHref, parseTableNumber, readTableFromSearch } from "@/lib/tables";
import { demoMenuRepo } from "@/lib/data/demo";
import { resetDemoStore } from "@/lib/data/demo-store";
import type { CartLine, MenuItem } from "@/lib/types";

beforeEach(() => {
  resetDemoStore();
});

describe("table numbers", () => {
  it("accepts a positive integer string", () => {
    expect(parseTableNumber("4")).toBe(4);
    expect(parseTableNumber(" 12 ")).toBe(12);
  });

  it("accepts a positive integer", () => {
    expect(parseTableNumber(6)).toBe(6);
  });

  it("rejects zero, negatives, junk and huge values", () => {
    expect(parseTableNumber("0")).toBeNull();
    expect(parseTableNumber("-2")).toBeNull();
    expect(parseTableNumber("abc")).toBeNull();
    expect(parseTableNumber("")).toBeNull();
    expect(parseTableNumber("9999")).toBeNull();
    expect(parseTableNumber("1.5")).toBeNull();
    expect(parseTableNumber(null)).toBeNull();
    expect(parseTableNumber(undefined)).toBeNull();
    expect(parseTableNumber({})).toBeNull();
  });

  it("reads the table from a query string", () => {
    expect(readTableFromSearch("?table=7")).toBe(7);
    expect(readTableFromSearch("table=7&x=1")).toBe(7);
  });

  it("returns null when the table is missing or broken", () => {
    expect(readTableFromSearch("")).toBeNull();
    expect(readTableFromSearch("?table=banana")).toBeNull();
  });

  it("builds the QR target url", () => {
    expect(orderHref(3)).toBe("/order?table=3");
  });

  it("falls back to a sensible table list", () => {
    const tables = getTableNumbers();
    expect(tables.length).toBeGreaterThan(0);
    expect(tables).toEqual([...tables].sort((a, b) => a - b));
    expect(new Set(tables).size).toBe(tables.length);
  });
});

describe("order session", () => {
  it("remembers the order per table", () => {
    rememberSessionOrder(4, "o-123");
    expect(readSessionOrderId(4)).toBe("o-123");
  });

  it("keeps tables separate", () => {
    rememberSessionOrder(4, "o-123");
    expect(readSessionOrderId(5)).toBeNull();
  });

  it("forgets an order on request", () => {
    rememberSessionOrder(4, "o-123");
    forgetSessionOrder(4);
    expect(readSessionOrderId(4)).toBeNull();
  });

  it("returns null when nothing is stored", () => {
    expect(readSessionOrderId(9)).toBeNull();
  });
});

describe("config", () => {
  it("runs in demo mode without Firebase env vars", () => {
    expect(isDemoMode).toBe(true);
  });

  it("always yields a usable staff PIN", () => {
    expect(getDemoStaffPin()).toMatch(/^\d{4,6}$/);
  });
});

describe("placeOrder", () => {
  const item = (over: Partial<MenuItem> = {}): MenuItem => ({
    id: "m1",
    name: "Cappuccino",
    description: "",
    price: 180,
    category: "Drinks",
    available: true,
    sortOrder: 10,
    ...over,
  });

  const line = (over: Partial<CartLine> = {}): CartLine => ({
    menuItemId: "m1",
    name: "Cappuccino",
    price: 180,
    qty: 1,
    category: "Drinks",
    ...over,
  });

  it("re-prices against the live menu, not the cart copy", async () => {
    const menu = [item({ price: 210 })];
    const order = await placeOrder({
      tableNumber: 2,
      cartLines: [line({ price: 150 })],
      menu,
    });
    expect(order.items[0].price).toBe(210);
    expect(order.total).toBe(210);
  });

  it("rejects a sold-out item with a customer-readable reason", async () => {
    await expect(
      placeOrder({
        tableNumber: 2,
        cartLines: [line()],
        menu: [item({ available: false })],
      }),
    ).rejects.toBeInstanceOf(OrderRejected);
  });

  it("rejects a deleted item", async () => {
    await expect(
      placeOrder({ tableNumber: 2, cartLines: [line()], menu: [] }),
    ).rejects.toThrow(/no longer on the menu/i);
  });

  it("rejects an empty basket", async () => {
    await expect(
      placeOrder({ tableNumber: 2, cartLines: [], menu: [item()] }),
    ).rejects.toThrow(/empty/i);
  });

  it("rejects an invalid table number", async () => {
    await expect(
      placeOrder({ tableNumber: 0, cartLines: [line()], menu: [item()] }),
    ).rejects.toThrow(/table/i);
  });

  it("writes through to the repository so the staff board sees it", async () => {
    const menu = await demoMenuRepo.list();
    const first = menu[0];
    const order = await placeOrder({
      tableNumber: 5,
      cartLines: [
        {
          menuItemId: first.id,
          name: first.name,
          price: first.price,
          qty: 2,
          category: first.category,
        },
      ],
      menu,
    });
    expect(order.status).toBe("preparing");
    expect(order.tableNumber).toBe(5);
    expect(order.total).toBe(first.price * 2);
  });

  it("trims and drops an empty note", async () => {
    const menu = [item()];
    const withNote = await placeOrder({
      tableNumber: 1,
      cartLines: [line()],
      menu,
      notes: "  extra hot  ",
    });
    expect(withNote.notes).toBe("extra hot");

    const without = await placeOrder({
      tableNumber: 1,
      cartLines: [line()],
      menu,
      notes: "   ",
    });
    expect(without.notes).toBeUndefined();
  });
});
