"use client";

/**
 * Order confirmation + live status (docs/requirements.md §4.1 steps 5–6).
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
import { useTableQuery } from "@/hooks/useTableQuery";
import { formatINR, lineSubtotal } from "@/lib/money";
import {
  CUSTOMER_STEPS,
  isFinalForCustomer,
  stepIndex,
  type OrderStatus,
} from "@/lib/order-status";
import { orderHref } from "@/lib/tables";
import type { OrderLine } from "@/lib/types";
import { readSessionOrderId, rememberSessionOrder } from "@/lib/order-session";

export default function ConfirmationPage() {
  return (
    <DataProvider>
      <ConfirmationScreen />
    </DataProvider>
  );
}

function ConfirmationScreen() {
  const {
    ready,
    tableNumber,
    orderId: idFromUrl,
    hasOrderId,
  } = useTableQuery();
  const [orderId, setOrderId] = useState<string | null>(null);

  // A refresh (or a back-navigation) can drop the id, so the per-table session
  // key in localStorage restores it and the customer lands back on their order.
  useEffect(() => {
    if (!ready) return;
    const remembered = tableNumber ? readSessionOrderId(tableNumber) : null;
    setOrderId(idFromUrl || remembered);
  }, [ready, tableNumber, idFromUrl]);

  if (!ready) return <Loading label="Finding your table…" />;

  if (tableNumber === null) {
    return (
      <EmptyState
        mood="worry"
        title="We lost that order"
        body="Head back to the menu and order again — it'll only take a moment."
        action={
          <Link href="/order">
            <Button>Back to the menu</Button>
          </Link>
        }
      />
    );
  }

  if (!orderId) {
    return <OrderNotFound tableNumber={tableNumber} hadId={hasOrderId} />;
  }

  return (
    <StatusScreen
      tableNumber={tableNumber}
      orderId={orderId}
      onRemember={() => rememberSessionOrder(tableNumber, orderId)}
    />
  );
}

/**
 * The id is gone and nothing is remembered for this table — a stale bookmark,
 * or a different phone. Send the customer back to the menu rather than showing
 * a dead end.
 */
function OrderNotFound({
  tableNumber,
  hadId,
}: {
  tableNumber: number;
  hadId: boolean;
}) {
  const router = useRouter();

  useEffect(() => {
    if (hadId) return;
    router.replace(orderHref(tableNumber));
  }, [hadId, router, tableNumber]);

  return <Loading label="Finding your order…" />;
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
    () =>
      order?.items.map((i) => ({
        menuItemId: i.menuItemId,
        name: i.name,
        price: i.price,
        qty: i.qty,
      })) ?? [],
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

      <header className="safe-t border-line-soft bg-cream/85 relative z-10 border-b-2 px-4 py-3 backdrop-blur-sm">
        <div className="shell text-muted flex items-center gap-2 text-sm font-semibold">
          <Icon name="pin" size={16} />
          Table {tableNumber}
          <span className="tnum rounded-pill bg-paper text-primary ml-auto px-2.5 py-0.5">
            Order #{order.orderNumber || "—"}
          </span>
        </div>
      </header>

      <main className="shell relative z-10 flex flex-col gap-5 pt-6">
        {/* big and clear: mascot + speech bubble + order number (§4.1 step 6) */}
        <section className="flex flex-col items-center gap-3 text-center">
          <Mascot mood={done ? "cheer" : "happy"} size={132} />
          <div>
            <h1 className="font-hand text-primary text-4xl leading-none">
              {done ? "All yours!" : "Got it!"}
            </h1>
            <p className="text-muted mt-1">
              Order{" "}
              <span className="tnum font-round text-ink text-lg">
                #{order.orderNumber}
              </span>{" "}
              is on its way to table {tableNumber}.
            </p>
          </div>
        </section>

        {/* the big mascot is already right above, so no second one here */}
        <SpeechBubble
          mood={done ? "cheer" : "happy"}
          tail="none"
          showMascot={false}
        >
          {done
            ? "Enjoy! Pay at the counter whenever you're ready."
            : offer.enabled && offer.text
              ? offer.text
              : "We'll bring it over. Sit tight, this takes a minute."}
        </SpeechBubble>

        <StatusTimeline current={order.status} activeStep={activeStep} />

        <Card className="overflow-hidden">
          <h2 className="border-line-soft border-b-2 px-4 py-2.5 text-lg">
            What you ordered
          </h2>
          <ul className="divide-line-soft divide-y-2">
            {order.items.map((line) => (
              <li
                key={`${line.menuItemId}-${line.name}`}
                className="flex items-center justify-between gap-3 px-4 py-2.5"
              >
                <span className="tnum font-round text-primary w-6 shrink-0">
                  {line.qty}×
                </span>
                <span className="text-ink min-w-0 flex-1 truncate">
                  {line.name}
                </span>
                <span className="tnum text-body shrink-0 font-semibold">
                  {formatINR(lineSubtotal(line))}
                </span>
              </li>
            ))}
            <li className="bg-highlight-soft/40 flex items-center justify-between gap-3 px-4 py-3">
              <span className="font-round text-ink text-lg">Total</span>
              <span className="tnum font-round text-primary text-xl">
                {formatINR(order.total)}
              </span>
            </li>
          </ul>
        </Card>

        <p className="border-line bg-tan/50 text-body rounded-md border-2 border-dashed px-4 py-3 text-center text-sm">
          <Icon
            name="leaf"
            size={16}
            className="mr-1 inline-block align-[-2px]"
          />
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
                  "rounded-pill h-1.5 transition-colors duration-500",
                  done ? "bg-sage" : active ? "bg-highlight" : "bg-tan-deep/60",
                ].join(" ")}
              />
              <div className="mt-1.5 flex justify-center">
                <StatusBadge
                  status={step}
                  size="sm"
                  className={
                    active ? "animate-badge-pop" : !done ? "opacity-55" : ""
                  }
                />
              </div>
            </li>
          );
        })}
      </ol>
      <p className="text-muted mt-3 text-center text-sm" aria-live="polite">
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
