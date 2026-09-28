"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Icon } from "@/components/icons";
import { InstallHint } from "@/components/Pwa";
import { Mascot } from "@/components/Mascot";
import { NotSetUp } from "@/components/NotSetUp";
import { OwnerSwitch } from "@/components/OwnerSwitch";
import {
  DataProvider,
  useActiveOrders,
  useIsDemo,
  useMenu,
  useStaffSession,
} from "@/components/providers/DataProvider";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState, Loading } from "@/components/ui/Loading";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { TicketTotal, TotalWarning } from "@/components/TotalWarning";
import { useOrderChime } from "@/hooks/useOrderChime";
import { getCafeName } from "@/lib/config";
import {
  friendlySignInError,
  friendlyStatusError,
} from "@/lib/friendly-errors";
import { formatINR, formatWait, lineSubtotal } from "@/lib/money";
import { checkOrderIntegrity } from "@/lib/order-integrity";
import { actionsFor, transition, type OrderStatus } from "@/lib/order-status";
import type { MenuItem, Order } from "@/lib/types";
import { DEMO_CREDENTIALS } from "@/lib/data/seed";

export default function StaffPage() {
  return (
    <DataProvider>
      <StaffScreen />
    </DataProvider>
  );
}

function StaffScreen() {
  const { user, loading, signIn, signInWithPin, signOut } = useStaffSession();
  const isDemo = useIsDemo();
  const router = useRouter();
  // The owner signing in here usually wants the dashboard, so send them there —
  // but only straight after signing in on this screen. Redirecting every owner
  // visit would make the order board unreachable for them, including from the
  // Orders | Owner switch, which links back here.
  const [signedInHere, setSignedInHere] = useState(false);
  const ownerJustSignedIn = signedInHere && user?.role === "owner";
  useEffect(() => {
    if (ownerJustSignedIn) router.replace("/admin");
  }, [ownerJustSignedIn, router]);
  const signInHere = useCallback(
    async (email: string, password: string) => {
      await signIn(email, password);
      setSignedInHere(true);
    },
    [signIn],
  );
  const { muted, setMuted, armed, unlock, chime, buzz } = useOrderChime();
  // Only once there is a staff session: the rules refuse a list to anyone who
  // is not staff, so subscribing earlier — or as an account with no /staff
  // document — just guarantees a permission error.
  const canWork = Boolean(user) && user?.role !== "unassigned";
  const { orders, loading: ordersLoading, error } = useActiveOrders(canWork);
  // The live menu, to re-price every ticket against (issue #27). Menu reads are
  // public and it is one small collection, so this is one cheap listener.
  const { items: menu } = useMenu();
  const [tableFilter, setTableFilter] = useState<number | "all">("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<{
    orderId: string;
    message: string;
  } | null>(null);

  const known = useRef<Set<string>>(new Set());
  const primed = useRef(false);
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set());

  // New-order alert: sound + vibration, once per unseen order id
  // (docs/requirements.md §5.3, docs/anime-theme.md §5 — not just a toast).
  useEffect(() => {
    if (ordersLoading) return;

    if (!primed.current) {
      // First snapshot: adopt whatever is already in flight without alarming.
      orders.forEach((o) => known.current.add(o.id));
      primed.current = true;
      return;
    }

    const fresh = orders.filter((o) => !known.current.has(o.id));
    orders.forEach((o) => known.current.add(o.id));
    if (fresh.length === 0) return;

    setFreshIds(new Set(fresh.map((o) => o.id)));
    const timer = setTimeout(() => setFreshIds(new Set()), 4200);
    chime();
    buzz();
    return () => clearTimeout(timer);
  }, [orders, ordersLoading, chime, buzz]);

  // Browsers only allow audio after a gesture; arm on the first interaction.
  useEffect(() => {
    const onFirst = () => unlock();
    window.addEventListener("pointerdown", onFirst, { once: true });
    window.addEventListener("keydown", onFirst, { once: true });
    return () => {
      window.removeEventListener("pointerdown", onFirst);
      window.removeEventListener("keydown", onFirst);
    };
  }, [unlock]);

  const tables = useMemo(
    () => [...new Set(orders.map((o) => o.tableNumber))].sort((a, b) => a - b),
    [orders],
  );
  const visible = useMemo(
    () =>
      tableFilter === "all"
        ? orders
        : orders.filter((o) => o.tableNumber === tableFilter),
    [orders, tableFilter],
  );

  const advance = useCallback(async (order: Order, to: OrderStatus) => {
    setBusyId(order.id);
    setActionError(null);
    try {
      // Guard the transition client-side too; the Firestore rules are the
      // real enforcement, this keeps the UI honest in demo mode. It used to
      // return silently, which is how a button that could never work ("Complete"
      // on a Ready ticket) looked like a dead tap instead of a bug.
      if (!transition(order.status, to)) {
        setActionError({
          orderId: order.id,
          message:
            "That step isn't allowed from here — the order may have already moved on.",
        });
        return;
      }
      const { loadBundle } = await import("@/lib/data");
      const bundle = await loadBundle();
      await bundle.orders.setStatus(order.id, to);
    } catch (err) {
      setActionError({ orderId: order.id, message: friendlyStatusError(err) });
    } finally {
      setBusyId(null);
    }
  }, []);

  if (loading) return <Loading label="Checking your badge…" />;
  if (ownerJustSignedIn)
    return <Loading label="Opening the owner dashboard…" />;

  if (!user) {
    return (
      <StaffLogin
        signIn={signInHere}
        signInWithPin={signInWithPin}
        isDemo={isDemo}
        onFirstGesture={unlock}
      />
    );
  }

  if (user.role === "unassigned") {
    return <NotSetUp user={user} onSignOut={() => void signOut()} />;
  }

  return (
    <div className="min-h-svh pb-10">
      <header className="safe-t border-line-soft bg-cream/95 sticky top-0 z-30 border-b-2 backdrop-blur">
        <div className="shell-wide flex items-center gap-2.5 py-2.5">
          <Mascot size={40} className="shrink-0" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg leading-tight">Order board</h1>
            <p className="text-2xs text-muted truncate font-semibold tracking-[0.12em] uppercase">
              {getCafeName()} · {user.displayName}
              {user.role === "owner" ? " (owner)" : ""}
            </p>
          </div>

          <button
            type="button"
            onClick={() => setMuted(!muted)}
            aria-pressed={muted}
            aria-label={
              muted ? "Unmute new order sound" : "Mute new order sound"
            }
            title={muted ? "Sound off" : "Sound on"}
            className={[
              "rounded-pill grid size-11 shrink-0 place-items-center border-2 transition-colors",
              muted
                ? "border-line bg-tan text-muted"
                : "border-primary bg-paper text-primary",
            ].join(" ")}
          >
            <Icon name={muted ? "mute" : "sound"} size={20} />
          </button>

          <button
            type="button"
            onClick={() => void signOut()}
            aria-label="Sign out"
            className="rounded-pill border-line bg-paper text-muted grid size-11 shrink-0 place-items-center border-2"
          >
            <Icon name="logout" size={20} />
          </button>
        </div>

        <OwnerSwitch
          role={user.role}
          current="orders"
          className="shell-wide pb-2.5"
        />

        {!armed && !muted ? (
          <p className="shell-wide text-2xs text-secondary pb-2 font-semibold">
            Tap anywhere to switch the order sound on.
          </p>
        ) : null}
      </header>

      <InstallHint appName={getCafeName()} />

      <main className="shell-wide pt-4">
        {error ? (
          <p
            role="alert"
            className="border-berry bg-paper text-berry-deep mb-3 rounded-md border-2 px-3 py-2 text-sm"
          >
            Live updates dropped: {error.message}
          </p>
        ) : null}

        <div className="mb-3 flex items-center gap-2 overflow-x-auto pb-1">
          <FilterChip
            active={tableFilter === "all"}
            onClick={() => setTableFilter("all")}
          >
            All ({orders.length})
          </FilterChip>
          {tables.map((n) => (
            <FilterChip
              key={n}
              active={tableFilter === n}
              onClick={() => setTableFilter(n)}
            >
              T{n} ({orders.filter((o) => o.tableNumber === n).length})
            </FilterChip>
          ))}
        </div>

        {ordersLoading ? (
          <Loading label="Listening for orders…" />
        ) : visible.length === 0 ? (
          <EmptyState
            mood="sleepy"
            title={
              orders.length === 0 ? "All caught up" : "Nothing on that table"
            }
            body={
              orders.length === 0
                ? "New orders appear here the moment a customer taps Place order."
                : undefined
            }
          />
        ) : (
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {visible.map((order) => (
              <OrderTicket
                key={order.id}
                order={order}
                menu={menu}
                isFresh={freshIds.has(order.id)}
                busy={busyId === order.id}
                error={
                  actionError?.orderId === order.id ? actionError.message : null
                }
                onAdvance={(to) => void advance(order, to)}
              />
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={[
        "rounded-pill font-round min-h-11 shrink-0 border-2 px-4 text-sm transition-colors",
        active
          ? "border-primary bg-primary text-on-dark"
          : "border-line bg-paper text-ink",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function OrderTicket({
  order,
  menu,
  isFresh,
  busy,
  error,
  onAdvance,
}: {
  order: Order;
  menu: MenuItem[];
  isFresh: boolean;
  busy: boolean;
  /** Why the last status change on this ticket failed, if it did. */
  error: string | null;
  onAdvance: (to: OrderStatus) => void;
}) {
  // 1s tick keeps the wait timer live without a Firestore read.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const waited = now - order.createdAt;
  const urgent = waited > 8 * 60_000;
  const warn = waited > 4 * 60_000;
  const actions = actionsFor(order.status);
  // The total on the order came from the customer's phone. Re-derive it here,
  // where the money is taken, so a doctored one cannot slip past the counter.
  const check = useMemo(() => checkOrderIntegrity(order, menu), [order, menu]);

  return (
    <Card
      data-order-id={order.id}
      className={[
        "flex flex-col overflow-hidden",
        isFresh ? "animate-alert-flash border-berry" : "",
      ].join(" ")}
    >
      <div className="border-line-soft flex items-center gap-3 border-b-2 px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="flex items-baseline gap-1.5">
            <span className="text-2xs text-muted font-semibold tracking-[0.12em] uppercase">
              Table
            </span>
            <span className="font-round text-primary text-3xl leading-none">
              {order.tableNumber}
            </span>
            <span className="tnum text-muted text-sm">
              #{order.orderNumber}
            </span>
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <StatusBadge status={order.status} size="sm" />
          <span
            className={[
              "tnum font-round flex items-center gap-1 text-sm",
              urgent
                ? "text-berry-deep"
                : warn
                  ? "text-secondary"
                  : "text-muted",
            ].join(" ")}
          >
            <Icon name="clock" size={14} />
            {formatWait(waited)}
          </span>
        </div>
      </div>

      <ul className="divide-line-soft flex-1 divide-y">
        {order.items.map((line) => (
          <li
            key={`${line.menuItemId}-${line.name}`}
            className="flex items-baseline gap-2 px-3 py-1.5"
          >
            <span className="tnum font-round text-primary w-7 shrink-0 text-lg">
              {line.qty}×
            </span>
            <span className="text-ink min-w-0 flex-1 text-[0.95rem] leading-snug">
              {line.name}
            </span>
            <span className="tnum text-muted shrink-0 text-sm">
              {formatINR(lineSubtotal(line))}
            </span>
          </li>
        ))}
      </ul>

      {order.notes ? (
        <p className="border-line bg-tan/60 text-body mx-3 mb-2 rounded-sm border-2 border-dashed px-2.5 py-1.5 text-sm">
          <span className="font-semibold">Note:</span> {order.notes}
        </p>
      ) : null}

      <TotalWarning check={check} />

      {error ? (
        <p
          role="alert"
          className="border-berry bg-paper text-berry-deep mx-3 mb-2 rounded-sm border-2 px-2.5 py-1.5 text-sm font-semibold"
        >
          {error}
        </p>
      ) : null}

      <div className="border-line-soft flex items-center justify-between gap-2 border-t-2 px-3 py-2">
        <TicketTotal check={check} />
        <div className="flex flex-wrap justify-end gap-2">
          {actions.length === 0 ? (
            <span className="text-muted text-sm">Closed</span>
          ) : (
            actions
              .slice()
              .sort((a, b) => Number(b.primary) - Number(a.primary))
              .map((action) => (
                <Button
                  key={action.to}
                  size="sm"
                  variant={action.variant}
                  disabled={busy}
                  onClick={() => onAdvance(action.to)}
                >
                  {action.label}
                </Button>
              ))
          )}
        </div>
      </div>
    </Card>
  );
}

function StaffLogin({
  signIn,
  signInWithPin,
  isDemo,
  onFirstGesture,
}: {
  signIn: (email: string, password: string) => Promise<void>;
  signInWithPin: (pin: string) => Promise<void>;
  isDemo: boolean;
  onFirstGesture: () => void;
}) {
  const [mode, setMode] = useState<"pin" | "password">(
    isDemo ? "pin" : "password",
  );
  const [pin, setPin] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    onFirstGesture();
    setBusy(true);
    setError(null);
    try {
      if (mode === "pin") await signInWithPin(pin);
      else await signIn(email, password);
    } catch (err) {
      setError(friendlySignInError(err));
    } finally {
      setBusy(false);
    }
  }

  function fillDemo(which: "staff" | "owner") {
    const creds = DEMO_CREDENTIALS[which];
    setMode("password");
    setEmail(creds.email);
    setPassword(creds.password);
    onFirstGesture();
  }

  return (
    <main className="relative flex min-h-svh flex-col items-center justify-center gap-4 px-5 py-10">
      <Mascot mood="worry" size={120} />
      <div className="text-center">
        <h1 className="font-hand text-primary text-4xl">Staff only</h1>
        <p className="text-muted text-sm">Counter view for {getCafeName()}</p>
      </div>

      <form
        onSubmit={submit}
        className="border-line bg-paper shadow-card flex w-full max-w-sm flex-col gap-3 rounded-lg border-2 p-4"
      >
        {isDemo ? (
          <div className="flex gap-2">
            {(["pin", "password"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setMode(m);
                  setError(null);
                }}
                aria-pressed={mode === m}
                className={[
                  "rounded-pill font-round min-h-11 flex-1 border-2 text-sm capitalize",
                  mode === m
                    ? "border-primary bg-primary text-on-dark"
                    : "border-line bg-cream text-ink",
                ].join(" ")}
              >
                {m === "pin" ? "PIN" : "Email"}
              </button>
            ))}
          </div>
        ) : null}

        {mode === "pin" ? (
          <label className="flex flex-col gap-1.5">
            <span className="text-ink text-sm font-semibold">
              Today&apos;s PIN
            </span>
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              className="tnum border-line bg-cream-soft font-round text-ink focus:border-primary min-h-14 rounded-sm border-2 text-center text-3xl tracking-[0.5em] focus:outline-none"
              placeholder="••••"
            />
          </label>
        ) : (
          <>
            <label className="flex flex-col gap-1.5">
              <span className="text-ink text-sm font-semibold">Email</span>
              <input
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="border-line bg-cream-soft text-ink focus:border-primary min-h-12 rounded-sm border-2 px-3 focus:outline-none"
                placeholder="staff@cafe.com"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-ink text-sm font-semibold">Password</span>
              <input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="border-line bg-cream-soft text-ink focus:border-primary min-h-12 rounded-sm border-2 px-3 focus:outline-none"
                placeholder="••••••••"
              />
            </label>
          </>
        )}

        {error ? (
          <p role="alert" className="text-berry-deep text-sm font-semibold">
            {error}
          </p>
        ) : null}

        <Button type="submit" size="lg" fullWidth disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </Button>

        {isDemo ? (
          <div className="border-secondary/50 bg-highlight-soft/40 text-2xs text-primary-dark rounded-sm border-2 border-dashed p-2.5 text-center leading-relaxed">
            <p className="font-semibold">Demo accounts</p>
            <p className="tnum">
              PIN 1122 · staff@demo.cafe / cafe1122 · owner@demo.cafe / cafe1122
            </p>
            <div className="mt-1.5 flex justify-center gap-2">
              <button
                type="button"
                onClick={() => fillDemo("staff")}
                className="rounded-pill border-secondary min-h-9 border-2 px-3 font-semibold"
              >
                Fill staff
              </button>
              <button
                type="button"
                onClick={() => fillDemo("owner")}
                className="rounded-pill border-secondary min-h-9 border-2 px-3 font-semibold"
              >
                Fill owner
              </button>
            </div>
          </div>
        ) : null}
      </form>
    </main>
  );
}
