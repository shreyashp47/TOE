"use client";

/**
 * Order confirmation + live status (requirements.md §4.1 steps 5–6).
 *
 * Closes open question #1 in §11: the customer DOES see live status. The screen
 * subscribes to their own order document, so the moment staff tap "Mark ready"
 * the phone updates — no refresh, no polling loop.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { SparkleBurst } from "@/components/Doodles";
import { Icon } from "@/components/icons";
import { Mascot } from "@/components/Mascot";
import {
  DataProvider,
  useMenu,
  useOrder,
  useSpecialOffer,
} from "@/components/providers/DataProvider";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState, Loading } from "@/components/ui/Loading";
import { SpeechBubble } from "@/components/ui/SpeechBubble";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useCart } from "@/hooks/useCart";
import { formatINR, lineSubtotal } from "@/lib/money";
import {
  CUSTOMER_STEPS,
  isFinalForCustomer,
  stepIndex,
  type OrderStatus,
} from "@/lib/order-status";
import { orderHref, parseTableNumber } from "@/lib/tables";
import type { OrderLine } from "@/lib/types";
import { readSessionOrderId, rememberSessionOrder } from "@/lib/order-session";

export default function ConfirmationPage({
  searchParams,
}: {
  searchParams: Promise<{ table?: string; id?: string }>;
}) {
  return (
    <DataProvider>
      <ConfirmationScreen searchParams={searchParams} />
    </DataProvider>
  );
}

function ConfirmationScreen({
  searchParams,
}: {
  searchParams: Promise<{ table?: string; id?: string }>;
}) {
  const router = useRouter();
  const [params, setParams] = useState<{ table?: string; id?: string }>({});
  void params;
  const [table, setTable] = useState<number | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void searchParams.then(async (p) => {
      if (!alive) return;
      setParams(p);
      const t = parseTableNumber(p.table);
      setTable(t);
      // A refresh (or a back-navigation) may drop the id; the per-table session
      // key in localStorage restores it so the customer lands back on their order.
      const fromUrl = p.id?.trim();
      const remembered = t ? readSessionOrderId(t) : null;
      const id = fromUrl || remembered;
      if (id) setOrderId(id);
      else if (t) router.replace(orderHref(t));
    });
    return () => {
      alive = false;
    };
  }, [searchParams, router]);

  if (table === null) return <Loading label="Finding your table…" />;
  if (!orderId) {
    return (
      <EmptyState
        mood="worry"
        title="We lost that order"
        body="Start again and we'll send a fresh one to the counter."
        action={
          <Link href={orderHref(table)}>
            <Button>Back to the menu</Button>
          </Link>
        }
      />
    );
  }

  return (
    <StatusScreen
      tableNumber={table}
      orderId={orderId}
      onRemember={() => rememberSessionOrder(table, orderId)}
    />
  );
}

function StatusScreen({
  tableNumber,
  orderId,
  onRemember,
}: {
  tableNumber: number;
  orderId: string;
  onRemember: () => void;
}) {
  const { order, loading } = useOrder(orderId);
  const offer = useSpecialOffer();
  // the live menu is only needed so the cart reconciler can drop sold-out lines
  const { items: menu } = useMenu();
  const cart = useCart(tableNumber, menu);

  const lastStatus = useRef<OrderStatus | null>(null);
  const [celebrate, setCelebrate] = useState(false);

  useEffect(() => {
    if (!order) return;
    onRemember();
    if (lastStatus.current === null) {
      lastStatus.current = order.status;
      return;
    }
    if (order.status !== lastStatus.current) {
      lastStatus.current = order.status;
      // brief 1.5s burst, then cleared so repeat use isn't slowed down
      setCelebrate(true);
      const timer = setTimeout(() => setCelebrate(false), 1600);
      return () => clearTimeout(timer);
    }
  }, [order, onRemember]);

  const previous = useMemo<OrderLine[]>(
    () => order?.items.map((i) => ({ menuItemId: i.menuItemId, name: i.name, price: i.price, qty: i.qty })) ?? [],
    [order],
  );

  if (loading) return <Loading label="Sending it up to the counter…" />;

  if (!order) {
    return (
      <main className="shell py-10">
        <EmptyState
          mood="worry"
          title="We can't find that order"
          body="It may have been cleared from this device. Ask the counter and we'll take another one."
          action={
            <Link href={orderHref(tableNumber)}>
              <Button>Start a new order</Button>
            </Link>
          }
        />
      </main>
    );
  }

  const done = isFinalForCustomer(order.status);
  const activeStep = stepIndex(order.status);

  return (
    <div className="relative min-h-svh pb-8">
      <SparkleBurst active={celebrate} />

      <header className="safe-t relative z-10 border-b-2 border-line-soft bg-cream/85 px-4 py-3 backdrop-blur-sm">
        <div className="shell flex items-center gap-2 text-sm font-semibold text-muted">
          <Icon name="pin" size={16} />
          Table {tableNumber}
          <span className="ml-auto tnum rounded-pill bg-paper px-2.5 py-0.5 text-primary">
            Order #{order.orderNumber || "—"}
          </span>
        </div>
      </header>

      <main className="shell relative z-10 flex flex-col gap-5 pt-6">
        {/* big and clear: mascot + speech bubble + order number (§4.1 step 6) */}
        <section className="flex flex-col items-center gap-3 text-center">
          <Mascot mood={done ? "cheer" : "happy"} size={132} />
          <div>
            <h1 className="font-hand text-4xl leading-none text-primary">
              {done ? "All yours!" : "Got it!"}
            </h1>
            <p className="mt-1 text-muted">
              Order <span className="tnum font-round text-lg text-ink">#{order.orderNumber}</span>{" "}
              is on its way to table {tableNumber}.
            </p>
          </div>
        </section>

        <SpeechBubble mood={done ? "cheer" : "happy"} tail="none">
          {done
            ? "Enjoy! Pay at the counter whenever you're ready."
            : offer.enabled && offer.text
              ? offer.text
              : "We'll bring it over. Sit tight, this takes a minute."}
        </SpeechBubble>

        <StatusTimeline current={order.status} activeStep={activeStep} />

        <Card className="overflow-hidden">
          <h2 className="border-b-2 border-line-soft px-4 py-2.5 text-lg">
            What you ordered
          </h2>
          <ul className="divide-y-2 divide-line-soft">
            {order.items.map((line) => (
              <li
                key={`${line.menuItemId}-${line.name}`}
                className="flex items-center justify-between gap-3 px-4 py-2.5"
              >
                <span className="tnum w-6 shrink-0 font-round text-primary">
                  {line.qty}×
                </span>
                <span className="min-w-0 flex-1 truncate text-ink">
                  {line.name}
                </span>
                <span className="tnum shrink-0 font-semibold text-body">
                  {formatINR(lineSubtotal(line))}
                </span>
              </li>
            ))}
            <li className="flex items-center justify-between gap-3 bg-highlight-soft/40 px-4 py-3">
              <span className="font-round text-lg text-ink">Total</span>
              <span className="tnum font-round text-xl text-primary">
                {formatINR(order.total)}
              </span>
            </li>
          </ul>
        </Card>

        <p className="rounded-md border-2 border-dashed border-line bg-tan/50 px-4 py-3 text-center text-sm text-body">
          <Icon name="leaf" size={16} className="mr-1 inline-block align-[-2px]" />
          Pay at the counter when you&apos;re done. Nothing to install, no OTP.
        </p>

        <div className="flex flex-col gap-2 pb-6 sm:flex-row">
          <Button
            variant="secondary"
            fullWidth
            disabled={previous.length === 0}
            onClick={() => {
              cart.reAdd(previous);
              window.location.assign(orderHref(tableNumber));
            }}
          >
            Order again
          </Button>
          <Button
            variant="ghost"
            fullWidth
            onClick={() => window.location.assign(orderHref(tableNumber))}
          >
            Back to the menu
          </Button>
        </div>
      </main>
    </div>
  );
}

function StatusTimeline({
  current,
  activeStep,
}: {
  current: OrderStatus;
  activeStep: number;
}) {
  return (
    <section aria-label="Order progress">
      <ol className="flex items-stretch gap-1.5">
        {CUSTOMER_STEPS.map((step, index) => {
          const done = index < activeStep;
          const active = index === activeStep;
          return (
            <li key={step} className="min-w-0 flex-1">
              <div
                className={[
                  "h-1.5 rounded-pill transition-colors duration-500",
                  done
                    ? "bg-sage"
                    : active
                      ? "bg-highlight"
                      : "bg-tan-deep/60",
                ].join(" ")}
              />
              <div className="mt-1.5 flex justify-center">
                <StatusBadge
                  status={step}
                  size="sm"
                  className={active ? "animate-badge-pop" : !done ? "opacity-55" : ""}
                />
              </div>
            </li>
          );
        })}
      </ol>
      <p className="mt-3 text-center text-sm text-muted" aria-live="polite">
        {current === "received"
          ? "The counter has your order."
          : current === "preparing"
            ? "Being made right now."
            : current === "ready"
              ? "Ready — a barista is bringing it over."
              : current === "served"
                ? "Served. Enjoy!"
                : "This order is closed."}
      </p>
    </section>
  );
}
