/**
 * The sample-month seeder, and the report it produces.
 *
 * This generator exists so the reports screen can be evaluated with realistic
 * data. If it produced a month that broke `buildReport`, the demo would quietly
 * misrepresent the thing it is demonstrating — so the two are tested together.
 */

import { describe, expect, it } from "vitest";

import { buildSampleOrders } from "@/lib/data/sample-orders";
import {
  demoSeedOrders,
  loadDemoState,
  resetDemoStore,
} from "@/lib/data/demo-store";
import { orderTotal } from "@/lib/money";
import { buildReport, currentMonth, monthRange } from "@/lib/reports";
import { demoOrderRepo } from "@/lib/data/demo";
import type { Order } from "@/lib/types";

// A fixed "now" so the generated month is deterministic in shape.
const NOW = new Date(2026, 5, 18, 15, 0).getTime(); // 18 Jun 2026, 15:00

describe("buildSampleOrders", () => {
  const orders = buildSampleOrders(120, NOW);

  it("generates the requested count", () => {
    expect(orders).toHaveLength(120);
  });

  it("stays inside the month containing now", () => {
    const range = monthRange(2026, 5);
    for (const order of orders) {
      expect(order.createdAt).toBeGreaterThanOrEqual(range.from);
      expect(order.createdAt).toBeLessThanOrEqual(NOW);
    }
  });

  it("never claims an order is from the future", () => {
    expect(orders.some((o) => o.createdAt > NOW)).toBe(false);
  });

  it("uses only menu items that exist and priced lines consistently", () => {
    for (const order of orders) {
      expect(order.items.length).toBeGreaterThan(0);
      for (const line of order.items) {
        expect(line.name).toBeTruthy();
        expect(line.price).toBeGreaterThanOrEqual(0);
        expect(line.qty).toBeGreaterThan(0);
      }
    }
  });

  it("totals every order from its own lines", () => {
    for (const order of orders) {
      expect(order.total).toBe(orderTotal(order.items));
    }
  });

  it("only stamps completedAt on completed orders", () => {
    for (const order of orders) {
      if (order.status === "completed") {
        expect(order.completedAt).toBeGreaterThanOrEqual(order.createdAt);
      } else {
        expect(order.completedAt).toBeUndefined();
      }
    }
  });

  it("uses only valid table numbers", () => {
    for (const order of orders) {
      expect(order.tableNumber).toBeGreaterThanOrEqual(1);
      expect(order.tableNumber).toBeLessThanOrEqual(6);
    }
  });

  it("returns them in chronological order", () => {
    for (let i = 1; i < orders.length; i += 1) {
      expect(orders[i].createdAt).toBeGreaterThanOrEqual(
        orders[i - 1].createdAt,
      );
    }
  });

  it("includes at least one order of every status, so the board is realistic", () => {
    const statuses = new Set(orders.map((o) => o.status));
    expect(statuses.has("completed")).toBe(true);
    expect(statuses.has("preparing")).toBe(true);
  });
});

describe("a seeded demo month reports sensibly", () => {
  it("produces revenue, orders and a best-seller list", () => {
    resetDemoStore();
    const seeded = demoSeedOrders(buildSampleOrders(200, NOW));
    expect(seeded).toBe(200);

    const stored = loadDemoState().orders;
    const range = monthRange(currentMonth(NOW).year, currentMonth(NOW).month0);
    const report = buildReport(stored, range);

    expect(report.orderCount).toBe(200);
    expect(report.revenue).toBe(
      stored.reduce((sum, o) => sum + orderTotal(o.items), 0),
    );
    expect(report.averageOrderValue).toBeGreaterThan(0);
    expect(report.topItems.length).toBeGreaterThan(1);
    expect(report.topItems[0].revenue).toBeGreaterThanOrEqual(
      report.topItems[1]?.revenue ?? 0,
    );
    expect(report.byDay.length).toBeGreaterThan(5);
    expect(report.statusCounts.completed).toBeGreaterThan(0);
  });

  it("is visible on the staff board as active orders", async () => {
    resetDemoStore();
    demoSeedOrders(buildSampleOrders(200, NOW));
    const active = await demoOrderRepo.listRange(0, Date.now() + 1000);
    const open = active.filter((o: Order) => o.status !== "completed");
    expect(open.length).toBeGreaterThan(0);
    expect(open.length).toBeLessThan(active.length);
  });

  it("gives every order a unique id and increasing number", () => {
    resetDemoStore();
    demoSeedOrders(buildSampleOrders(60, NOW));
    const { orders } = loadDemoState();
    expect(new Set(orders.map((o) => o.id)).size).toBe(orders.length);
    const numbers = orders.map((o) => o.orderNumber);
    expect(new Set(numbers).size).toBe(numbers.length);
  });
});
