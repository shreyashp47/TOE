"use client";

/**
 * Printable per-table QR cards (docs/requirements.md §5.5).
 *
 * "One static QR code per table, encoding table number in the URL. Generated
 * once, printed, placed on table — no dynamic regeneration needed." So the
 * cards are a print sheet, not a live view: encode once, print, laminate.
 *
 * It is also where the owner sets how many tables the cafe has. That list is
 * saved to config/tables and is what the customer's table picker offers and
 * what /order checks a scanned table number against, so the cards printed here
 * and the tables a customer can order from are always the same list.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import { useConfigRepo, useTables } from "@/components/providers/DataProvider";
import { TableListEditor } from "@/components/TableListEditor";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field, Input } from "@/components/ui/Input";
import { getBaseUrl, getCafeName, getCafeTagline } from "@/lib/config";
import { qrToSvg } from "@/lib/qr";

export default function QrPage() {
  const pinned = getBaseUrl();
  const [origin, setOrigin] = useState(pinned);
  const repo = useConfigRepo();
  // Cards follow the *saved* list, not the editor's draft: a card printed for
  // a table that was never saved would send customers to "that table number
  // looks odd".
  const { tables, saved, loading } = useTables();
  const saveTables = useCallback(
    async (next: number[]) => {
      if (!repo) throw new Error("Storage is not ready yet.");
      await repo.saveTables(next);
    },
    [repo],
  );

  useEffect(() => {
    // Without a pinned base URL, bake in whatever host this page is served
    // from, so the printed card works before a domain cutover.
    if (!pinned) setOrigin(window.location.origin);
  }, [pinned]);

  const base = origin.replace(/\/+$/, "");
  const valid = /^https?:\/\//i.test(base) && !loading && tables.length > 0;

  return (
    <div className="flex flex-col gap-4 pb-8">
      <Card className="p-4 print:hidden">
        <h2 className="text-lg">Your tables</h2>
        <p className="text-muted mt-0.5 mb-3 text-sm">
          Customers pick from these tables, and a QR code for any other number
          is turned away. Changes reach customers&apos; phones straight away.
        </p>
        <TableListEditor
          tables={tables}
          saved={saved}
          loading={loading}
          onSave={saveTables}
        />
      </Card>

      <Card className="p-4 print:hidden">
        <h2 className="text-lg">Table QR codes</h2>
        <p className="text-muted mt-0.5 text-sm">
          Print this page, cut along the lines, and put one card on each table.
          The codes never need regenerating — they only depend on the address
          below.
        </p>

        <div className="mt-3 grid gap-3">
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
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button onClick={() => window.print()} disabled={!valid}>
            Print {tables.length} card{tables.length === 1 ? "" : "s"}
          </Button>
          {loading ? null : !valid ? (
            <p role="alert" className="text-berry-deep text-sm font-semibold">
              Enter a full address starting with http:// or https://
            </p>
          ) : (
            <p className="text-muted text-sm">
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
        <p className="font-hand text-primary text-3xl leading-none">
          {getCafeName()}
        </p>
        <p className="text-2xs text-muted font-semibold tracking-[0.18em] uppercase">
          {getCafeTagline()}
        </p>

        <div className="border-line-soft rounded-md border-2 bg-white p-3">
          {svg ? (
            <span
              className="block size-[9.5rem] sm:size-[11rem]"
              // Generated locally from the table URL by src/lib/qr.ts — no
              // third-party QR image service, so it also works offline.
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          ) : (
            <p className="text-berry-deep text-sm">
              Could not build this code.
            </p>
          )}
        </div>

        <div>
          <p className="font-round text-ink text-2xl">Table {table}</p>
          <p className="text-muted mt-1 text-sm">
            Scan to open the menu and order
          </p>
        </div>

        <p className="tnum text-2xs text-muted break-all">{url}</p>

        <p className="rounded-pill bg-highlight-soft font-hand text-primary-dark px-3 py-1 text-xl">
          No app needed. Pay at the counter.
        </p>
      </Card>
    </li>
  );
}
