/**
 * Report aggregation (requirements.md §4.3 steps 3–4, §5.4).
 *
 * Pure functions over an order list so the maths can be unit-tested and reused
 * by both the dashboard and the CSV export. Everything is whole rupees.
 */

import { orderTotal } from "./money";
import type { Order } from "./types";

export interface Range {
  /** inclusive */
  from: number;
  /** exclusive */
  to: number;
}

export interface TopItem {
  name: string;
  qty: number;
  revenue: number;
  /** 0–1 share of revenue */
  share: number;
}

export interface DayBucket {
  /** YYYY-MM-DD in local time */
  date: string;
  label: string;
  revenue: number;
  orders: number;
}

export interface Report {
  range: Range;
  orderCount: number;
  revenue: number;
  /** 0 when there were no orders */
  averageOrderValue: number;
  topItems: TopItem[];
  byDay: DayBucket[];
  /** Per-status counts, so the owner can see how many closed out. */
  statusCounts: Record<string, number>;
}

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const dayLabel = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
});

export function dayLabelOf(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return dayLabel.format(new Date(y, (m ?? 1) - 1, d ?? 1));
}

/** Local-time month range. `to` is exclusive so month ends don't overlap. */
export function monthRange(year: number, month0: number): Range {
  return {
    from: new Date(year, month0, 1).getTime(),
    to: new Date(year, month0 + 1, 1).getTime(),
  };
}

export function currentMonth(now = Date.now()): { year: number; month0: number } {
  const d = new Date(now);
  return { year: d.getFullYear(), month0: d.getMonth() };
}

export function shiftMonth(
  year: number,
  month0: number,
  delta: number,
): { year: number; month0: number } {
  // Date handles month overflow, including negative values.
  const d = new Date(year, month0 + delta, 1);
  return { year: d.getFullYear(), month0: d.getMonth() };
}

export function buildReport(orders: Order[], range: Range): Report {
  const inRange = orders
    .filter((o) => o.createdAt >= range.from && o.createdAt < range.to)
    .sort((a, b) => a.createdAt - b.createdAt);

  const revenue = inRange.reduce((sum, o) => sum + orderTotal(o.items), 0);
  const orderCount = inRange.length;

  const byName = new Map<string, { qty: number; revenue: number }>();
  const dayMap = new Map<string, { revenue: number; orders: number }>();
  const statusCounts: Record<string, number> = {};

  for (const order of inRange) {
    statusCounts[order.status] = (statusCounts[order.status] ?? 0) + 1;

    const key = dayKey(order.createdAt);
    const bucket = dayMap.get(key) ?? { revenue: 0, orders: 0 };
    bucket.revenue += orderTotal(order.items);
    bucket.orders += 1;
    dayMap.set(key, bucket);

    for (const line of order.items) {
      const entry = byName.get(line.name) ?? { qty: 0, revenue: 0 };
      entry.qty += line.qty;
      entry.revenue += line.price * line.qty;
      byName.set(line.name, entry);
    }
  }

  const topItems: TopItem[] = [...byName.entries()]
    .map(([name, v]) => ({
      name,
      qty: v.qty,
      revenue: v.revenue,
      share: revenue > 0 ? v.revenue / revenue : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue || b.qty - a.qty || a.name.localeCompare(b.name));

  const byDay: DayBucket[] = [...dayMap.entries()]
    .map(([date, v]) => ({
      date,
      label: dayLabelOf(date),
      revenue: v.revenue,
      orders: v.orders,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    range,
    orderCount,
    revenue,
    averageOrderValue: orderCount > 0 ? Math.round(revenue / orderCount) : 0,
    topItems,
    byDay,
    statusCounts,
  };
}

/** Peak day, used to scale the CSS bar chart without a charting library. */
export function peakDay(byDay: DayBucket[]): number {
  return byDay.reduce((max, d) => Math.max(max, d.revenue), 0);
}

function csvCell(value: unknown): string {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Order-line level CSV — what an accountant actually wants. */
export function ordersToCsv(orders: Order[]): string {
  const header = [
    "Order #",
    "Table",
    "Placed at",
    "Status",
    "Completed at",
    "Item",
    "Qty",
    "Unit price",
    "Line total",
    "Order total",
    "Payment",
    "Notes",
  ];

  const rows: string[] = [];
  const fmt = (ms?: number) =>
    ms ? new Date(ms).toISOString() : "";

  for (const order of [...orders].sort((a, b) => a.createdAt - b.createdAt)) {
    const total = orderTotal(order.items);
    for (const line of order.items) {
      rows.push(
        [
          order.orderNumber,
          order.tableNumber,
          fmt(order.createdAt),
          order.status,
          fmt(order.completedAt),
          line.name,
          line.qty,
          line.price,
          line.price * line.qty,
          total,
          order.paymentMethod,
          order.notes ?? "",
        ]
          .map(csvCell)
          .join(","),
      );
    }
  }

  return [header.join(","), ...rows].join("\n");
}

export { startOfDay };
