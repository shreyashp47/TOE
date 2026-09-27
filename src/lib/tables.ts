/** Table-number plumbing for `/order?table=N` (requirements.md §5.5). */

import { getTableNumbers } from "./config";

/** Accepts `?table=4`, `#table=4`, or a bare `4`. */
export function parseTableNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^\d{1,3}$/.test(trimmed)) return null;
  const n = Number.parseInt(trimmed, 10);
  return n > 0 ? n : null;
}

export function readTableFromSearch(search: string): number | null {
  const params = new URLSearchParams(search);
  return parseTableNumber(params.get("table"));
}

export function orderHref(tableNumber: number): string {
  return `/order?table=${tableNumber}`;
}

export { getTableNumbers };
