/**
 * Regression tests for the QR entry point.
 *
 * The `/order` page is statically prerendered, which means Next.js hands the
 * client component a plain `{}` for `searchParams` rather than a Promise. The
 * original implementation awaited it, which threw in production only and sent
 * every customer who scanned a QR code to the fallback table picker instead of
 * the menu. These tests pin the behaviour that actually ships.
 */

import { render, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useTableQuery } from "@/hooks/useTableQuery";
import { orderHref, parseTableNumber, readTableFromSearch } from "@/lib/tables";

function setLocation(search: string) {
  window.history.replaceState({}, "", `/order${search}`);
}

beforeEach(() => setLocation(""));
afterEach(() => setLocation(""));

describe("useTableQuery", () => {
  it("resolves a valid table from the query string", () => {
    setLocation("?table=4");
    const { result } = renderHook(() => useTableQuery());
    expect(result.current.ready).toBe(true);
    expect(result.current.tableNumber).toBe(4);
  });

  it("reports a missing table as null rather than throwing", () => {
    const { result } = renderHook(() => useTableQuery());
    expect(result.current.ready).toBe(true);
    expect(result.current.tableNumber).toBeNull();
    expect(result.current.raw).toBeNull();
  });

  it("returns unready on the very first render", () => {
    // The first paint must be the mascot loader, not a flash of the fallback
    // table picker on a QR scan.
    const seen: boolean[] = [];
    function Probe() {
      seen.push(useTableQuery().ready);
      return null;
    }
    render(<Probe />);
    expect(seen[0]).toBe(false);
    expect(seen.at(-1)).toBe(true);
  });

  it("keeps the raw value for the 'that looks odd' copy", () => {
    setLocation("?table=banana");
    const { result } = renderHook(() => useTableQuery());
    expect(result.current.tableNumber).toBeNull();
    expect(result.current.raw).toBe("banana");
  });

  it("ignores an empty table value", () => {
    setLocation("?table=");
    const { result } = renderHook(() => useTableQuery());
    expect(result.current.tableNumber).toBeNull();
  });

  it("handles a large table number", () => {
    setLocation("?table=12");
    const { result } = renderHook(() => useTableQuery());
    expect(result.current.tableNumber).toBe(12);
  });

  it("ignores unrelated query parameters", () => {
    setLocation("?utm_source=table-tent&utm_medium=qr&table=7");
    const { result } = renderHook(() => useTableQuery());
    expect(result.current.tableNumber).toBe(7);
  });

  it("surfaces the order id used by the confirmation screen", () => {
    setLocation("?table=3&id=o-abc");
    const { result } = renderHook(() => useTableQuery());
    expect(result.current.orderId).toBe("o-abc");
    expect(result.current.hasOrderId).toBe(true);
  });

  it("distinguishes a missing id from an empty one", () => {
    setLocation("?table=3");
    expect(renderHook(() => useTableQuery()).result.current.hasOrderId).toBe(
      false,
    );

    setLocation("?table=3&id=");
    const empty = renderHook(() => useTableQuery()).result.current;
    expect(empty.hasOrderId).toBe(true);
    expect(empty.orderId).toBeNull();
  });
});

describe("the QR url contract", () => {
  it("parses exactly what the QR generator encodes", () => {
    // /admin/qr encodes `${base}/order?table=N`
    const url = orderHref(6);
    expect(url).toBe("/order?table=6");
    expect(readTableFromSearch(url.slice(url.indexOf("?")))).toBe(6);
  });

  it("never produces a table of zero or less", () => {
    for (const bad of ["0", "-1", "1e3", "NaN", " ", "%20"]) {
      expect(parseTableNumber(bad)).toBeNull();
    }
  });

  it("does not accept a decimal or a signed number", () => {
    expect(parseTableNumber("2.5")).toBeNull();
    expect(parseTableNumber("+3")).toBeNull();
    expect(parseTableNumber(2.5)).toBeNull();
  });
});
