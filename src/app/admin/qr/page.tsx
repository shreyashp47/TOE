"use client";

/**
 * Printable per-table QR cards (requirements.md §5.5).
 *
 * "One static QR code per table, encoding table number in the URL. Generated
 * once, printed, placed on table — no dynamic regeneration needed." So this
 * screen is a print sheet, not a live view: encode once, print, laminate.
 */

import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field, Input } from "@/components/ui/Input";
import { getBaseUrl, getCafeName, getCafeTagline, getTableNumbers } from "@/lib/config";
import { qrToSvg } from "@/lib/qr";

export default function QrPage() {
  const pinned = getBaseUrl();
  const [origin, setOrigin] = useState(pinned);
  const [tableText, setTableText] = useState(() =>
    getTableNumbers().join(", "),
  );

  useEffect(() => {
    // Without a pinned base URL, bake in whatever host this page is served
    // from, so the printed card works before a domain cutover.
    if (!pinned) setOrigin(window.location.origin);
  }, [pinned]);

  const tables = useMemo(() => {
    const parsed = tableText
      .split(",")
      .map((t) => Number.parseInt(t.trim(), 10))
      .filter((n) => Number.isInteger(n) && n > 0);
    return [...new Set(parsed)].sort((a, b) => a - b);
  }, [tableText]);

  const base = origin.replace(/\/+$/, "");
  const valid = /^https?:\/\//i.test(base) && tables.length > 0;

  return (
    <div className="flex flex-col gap-4 pb-8">
      <Card className="p-4 print:hidden">
        <h2 className="text-lg">Table QR codes</h2>
        <p className="mt-0.5 text-sm text-muted">
          Print this page, cut along the lines, and put one card on each table.
          The codes never need regenerating — they only depend on the address
          below.
        </p>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field
            label="Address to print"
            htmlFor="base-url"
            hint="Your live site address, e.g. https://yourcafe.web.app"
          >
            <Input
              id="base-url"
              value={origin}
              onChange={(e) => setOrigin(e.target.value)}
              placeholder="https://yourcafe.web.app"
              inputMode="url"
            />
          </Field>
          <Field
            label="Table numbers"
            htmlFor="tables"
            hint="Comma separated, e.g. 1, 2, 3, 4, 5, 6"
          >
            <Input
              id="tables"
              value={tableText}
              onChange={(e) => setTableText(e.target.value)}
            />
          </Field>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button onClick={() => window.print()}>
            Print {tables.length} card{tables.length === 1 ? "" : "s"}
          </Button>
          {!valid ? (
            <p role="alert" className="text-sm font-semibold text-berry">
              Enter a full address starting with http:// or https://
            </p>
          ) : (
            <p className="text-sm text-muted">
              {tables.length} table{tables.length === 1 ? "" : "s"} ready.
            </p>
          )}
        </div>
      </Card>

      {valid ? (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 print:grid-cols-2">
          {tables.map((table) => (
            <TableCard
              key={table}
              table={table}
              url={`${base}/order?table=${table}`}
            />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function TableCard({ table, url }: { table: number; url: string }) {
  // Rendering the SVG needs a browser-free-safe encode; `qrToSvg` is pure.
  const svg = useMemo(() => {
    try {
      return qrToSvg(url);
    } catch {
      return null;
    }
  }, [url]);

  return (
    <li className="print:break-inside-avoid">
      <Card className="flex flex-col items-center gap-3 p-5 text-center">
        <p className="font-hand text-3xl leading-none text-primary">
          {getCafeName()}
        </p>
        <p className="text-2xs font-semibold uppercase tracking-[0.18em] text-muted">
          {getCafeTagline()}
        </p>

        <div className="rounded-md border-2 border-line-soft bg-white p-3">
          {svg ? (
            <span
              className="block size-[9.5rem] sm:size-[11rem]"
              // Generated locally from the table URL by src/lib/qr.ts — no
              // third-party QR image service, so it also works offline.
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          ) : (
            <p className="text-sm text-berry">Could not build this code.</p>
          )}
        </div>

        <div>
          <p className="font-round text-2xl text-ink">Table {table}</p>
          <p className="mt-1 text-sm text-muted">
            Scan to open the menu and order
          </p>
        </div>

        <p className="tnum break-all text-2xs text-muted">{url}</p>

        <p className="rounded-pill bg-highlight-soft px-3 py-1 font-hand text-xl text-primary-dark">
          No app needed. Pay at the counter.
        </p>
      </Card>
    </li>
  );
}
