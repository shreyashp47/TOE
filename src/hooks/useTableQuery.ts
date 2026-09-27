"use client";

/**
 * Table number from the URL — the app's front door, since every customer arrives
 * here by scanning a QR code.
 *
 * Reads `window.location.search` via `useQueryParams` rather than the
 * `searchParams` prop: on a statically prerendered route Next.js hands the
 * client component a plain `{}`, not a Promise, so awaiting it throws and the
 * customer lands on the fallback table picker instead of the menu. That bug only
 * appeared in a production build; see the test suite.
 *
 * Stays unready until mounted so the first paint is the mascot loader rather
 * than a flash of the wrong screen.
 */

import { useQueryParams } from "./useQueryParams";
import { parseTableNumber } from "@/lib/tables";

export interface TableQuery {
  ready: boolean;
  tableNumber: number | null;
  /** The raw `?table=` value, for the "that looks odd" copy. */
  raw: string | null;
  orderId: string | null;
  hasOrderId: boolean;
}

export function useTableQuery(): TableQuery {
  const params = useQueryParams();

  if (params === null) {
    return {
      ready: false,
      tableNumber: null,
      raw: null,
      orderId: null,
      hasOrderId: false,
    };
  }

  const raw = params.table ?? null;
  return {
    ready: true,
    tableNumber: parseTableNumber(raw),
    raw,
    orderId: params.id?.trim() || null,
    hasOrderId: "id" in params,
  };
}
