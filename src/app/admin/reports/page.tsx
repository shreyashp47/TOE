"use client";

/**
 * Monthly + date-range reporting (requirements.md §4.3 steps 3–4, §5.4).
 *
 * The chart is CSS-only: theme doc §6 says keep animations and the payload
 * small, and a monthly bar chart of 31 bars does not need a charting library.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import { Icon } from "@/components/icons";
import { useOrderRepo } from "@/components/providers/DataProvider";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field, Input } from "@/components/ui/Input";
import { EmptyState, Loading } from "@/components/ui/Loading";
import { formatINR } from "@/lib/money";
import {
  buildReport,
  currentMonth,
  monthRange,
  ordersToCsv,
  peakDay,
  shiftMonth,
} from "@/lib/reports";
import type { Order } from "@/lib/types";

type Mode = "month" | "range";

function toInputDate(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fromInputDate(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, y, m, d] = match;
  return new Date(Number(y), Number(m) - 1, Number(d)).getTime();
}

export default function ReportsPage() {
  const repo = useOrderRepo();
  const [mode, setMode] = useState<Mode>("month");
  const [cursor, setCursor] = useState(() => currentMonth());
  const [from, setFrom] = useState(() =>
    toInputDate(new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime()),
  );
  const [to, setTo] = useState(() => toInputDate(Date.now()));
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const range = useMemo(() => {
    if (mode === "month") return monthRange(cursor.year, cursor.month0);
    const start = fromInputDate(from);
    const end = fromInputDate(to);
    if (start === null || end === null) return null;
    // `to` is inclusive in the UI, exclusive in the query
    return { from: start, to: end + 86_400_000 };
  }, [mode, cursor, from, to]);

  const load = useCallback(async () => {
    if (!repo || !range) return;
    setLoading(true);
    setError(null);
    try {
      // Bounded range query keeps Firestore reads inside the free tier (§2, §5.4)
      setOrders(await repo.listRange(range.from, range.to));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load orders.");
    } finally {
      setLoading(false);
    }
  }, [repo, range]);

  useEffect(() => {
    void load();
  }, [load]);

  const report = useMemo(
    () => (range ? buildReport(orders, range) : null),
    [orders, range],
  );

  function downloadCsv() {
    const csv = ordersToCsv(orders);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cafe-orders-${toInputDate(range?.from ?? Date.now())}-to-${toInputDate((range?.to ?? Date.now()) - 1)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  if (loading && !report) return <Loading label="Adding up the month…" />;

  return (
    <div className="flex flex-col gap-4 pb-8">
      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          {mode === "month" ? (
            <div className="flex items-end gap-2">
              <Button
                variant="ghost"
                aria-label="Previous month"
                onClick={() => setCursor(shiftMonth(cursor.year, cursor.month0, -1))}
              >
                <Icon name="back" size={18} />
              </Button>
              <div className="min-w-[10rem] rounded-sm border-2 border-line bg-cream-soft px-3.5 py-2.5 text-center font-round text-lg text-ink">
                {new Date(cursor.year, cursor.month0, 1).toLocaleDateString(
                  "en-IN",
                  { month: "long", year: "numeric" },
                )}
              </div>
              <Button
                variant="ghost"
                aria-label="Next month"
                onClick={() => setCursor(shiftMonth(cursor.year, cursor.month0, 1))}
              >
                <Icon name="back" size={18} className="rotate-180" />
              </Button>
            </div>
          ) : (
            <div className="grid flex-1 gap-3 sm:grid-cols-2">
              <Field label="From" htmlFor="from">
                <Input
                  id="from"
                  type="date"
                  value={from}
                  max={to}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </Field>
              <Field label="To" htmlFor="to" hint="Inclusive.">
                <Input
                  id="to"
                  type="date"
                  value={to}
                  min={from}
                  onChange={(e) => setTo(e.target.value)}
                />
              </Field>
            </div>
          )}

          <div className="flex gap-2">
            {(["month", "range"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                aria-pressed={mode === m}
                className={[
                  "min-h-11 rounded-pill border-2 px-4 font-round text-sm capitalize",
                  mode === m
                    ? "border-primary bg-primary text-on-dark"
                    : "border-line bg-paper text-ink",
                ].join(" ")}
              >
                {m === "month" ? "This month" : "Custom dates"}
              </button>
            ))}
          </div>
        </div>
      </Card>

      {error ? (
        <p
          role="alert"
          className="rounded-md border-2 border-berry bg-paper px-3 py-2 text-sm text-berry"
        >
          {error}
        </p>
      ) : null}

      {report && report.orderCount === 0 ? (
        <EmptyState
          title="No orders in this period"
          body="Orders placed on the customer side show up here the moment they're completed."
        />
      ) : report ? (
        <>
          <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
            <Stat label="Revenue" value={formatINR(report.revenue)} icon="chart" />
            <Stat label="Orders" value={String(report.orderCount)} icon="cart" />
            <Stat
              label="Average order"
              value={formatINR(report.averageOrderValue)}
              icon="sparkle"
            />
          </ul>

          <Card className="p-4">
            <h2 className="text-lg">Revenue by day</h2>
            <RevenueChart report={report} />
          </Card>

          <Card className="overflow-hidden">
            <div className="flex items-center justify-between gap-3 border-b-2 border-line-soft px-4 py-3">
              <h2 className="text-lg">Best sellers</h2>
              <Button size="sm" variant="secondary" onClick={downloadCsv}>
                <Icon name="chart" size={16} />
                CSV
              </Button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[26rem] text-left">
                <thead>
                  <tr className="border-b-2 border-line-soft text-2xs uppercase tracking-wide text-muted">
                    <th scope="col" className="px-4 py-2 font-semibold">Item</th>
                    <th scope="col" className="px-2 py-2 text-right font-semibold">Sold</th>
                    <th scope="col" className="px-2 py-2 text-right font-semibold">Revenue</th>
                    <th scope="col" className="px-4 py-2 font-semibold">Share</th>
                  </tr>
                </thead>
                <tbody>
                  {report.topItems.map((item) => (
                    <tr
                      key={item.name}
                      className="border-b border-line-soft last:border-0"
                    >
                      <th scope="row" className="px-4 py-2 font-normal text-ink">
                        {item.name}
                      </th>
                      <td className="tnum px-2 py-2 text-right text-body">
                        {item.qty}
                      </td>
                      <td className="tnum px-2 py-2 text-right font-semibold text-primary">
                        {formatINR(item.revenue)}
                      </td>
                      <td className="px-4 py-2">
                        <span
                          className="flex h-2.5 w-full overflow-hidden rounded-pill bg-tan"
                          role="img"
                          aria-label={`${Math.round(item.share * 100)}% of revenue`}
                        >
                          <span
                            className="h-full rounded-pill bg-secondary"
                            style={{ width: `${Math.max(2, item.share * 100)}%` }}
                          />
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <p className="rounded-md border-2 border-dashed border-line bg-tan/50 px-4 py-3 text-sm text-body">
            Orders are never deleted automatically — six months of history is the
            target, and every figure above is recomputed from the full order
            list.
          </p>
        </>
      ) : null}
    </div>
  );
}

function Stat({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: "chart" | "cart" | "sparkle";
}) {
  return (
    <li className="rounded-lg border-2 border-line-soft bg-paper p-4 shadow-card">
      <p className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-[0.12em] text-muted">
        <Icon name={icon} size={14} />
        {label}
      </p>
      <p className="tnum mt-1 font-round text-2xl text-primary">{value}</p>
    </li>
  );
}

function RevenueChart({
  report,
}: {
  report: NonNullable<ReturnType<typeof buildReport>>;
}) {
  const peak = peakDay(report.byDay);

  if (report.byDay.length === 0) {
    return <p className="mt-2 text-sm text-muted">Nothing to chart yet.</p>;
  }

  return (
    <>
      <ol className="mt-3 flex h-36 items-end gap-1">
        {report.byDay.map((day) => {
          const height = peak > 0 ? Math.max(3, (day.revenue / peak) * 100) : 3;
          return (
            <li key={day.date} className="flex min-w-0 flex-1 flex-col items-center gap-1">
              <span
                className="w-full rounded-t-sm bg-secondary/85 transition-[height] duration-500"
                style={{ height: `${height}%` }}
                title={`${day.label}: ${formatINR(day.revenue)} from ${day.orders} order(s)`}
              />
              <span className="truncate text-2xs text-muted">{day.label}</span>
            </li>
          );
        })}
      </ol>
      <p className="mt-2 text-sm text-muted">
        Best day:{" "}
        <span className="tnum font-semibold text-ink">
          {[...report.byDay]
            .sort((a, b) => b.revenue - a.revenue)
            .slice(0, 1)
            .map((d) => `${d.label} · ${formatINR(d.revenue)}`)
            .join("")}
        </span>
      </p>
    </>
  );
}
