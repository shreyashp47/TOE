/**
 * Order status machine (docs/requirements.md §5.3, §4.2 step 6).
 *
 * The spec's baseline is `preparing` -> `completed`, explicitly "extendable to
 * `ready`, `served` later". This app takes that extension, because staff
 * benefit from a real "ready for pickup" hand-off and customers get a much
 * clearer promise from §4.1's `Received -> Preparing -> Ready/Served`:
 *
 *   received -> preparing -> ready -> served -> completed
 *
 * `completed` is terminal. It is never deleted from storage (§5.3: "keeps it in
 * the database for history — not deleted"), it only leaves the staff's active
 * board.
 */

export const ORDER_STATUSES = [
  "received",
  "preparing",
  "ready",
  "served",
  "completed",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Statuses that show up on the staff board. Everything else is history. */
export const ACTIVE_STATUSES = [
  "received",
  "preparing",
  "ready",
  "served",
] as const satisfies readonly OrderStatus[];

export type ActiveStatus = (typeof ACTIVE_STATUSES)[number];

/** Canonical forward path, index-aligned with ORDER_STATUSES. */
const NEXT: Record<OrderStatus, OrderStatus | null> = {
  received: "preparing",
  preparing: "ready",
  ready: "served",
  served: "completed",
  completed: null,
};

export const DEFAULT_STATUS: OrderStatus = "preparing";

export function isOrderStatus(value: unknown): value is OrderStatus {
  return (
    typeof value === "string" &&
    (ORDER_STATUSES as readonly string[]).includes(value)
  );
}

export function isActiveStatus(value: unknown): value is ActiveStatus {
  return (
    typeof value === "string" &&
    (ACTIVE_STATUSES as readonly string[]).includes(value)
  );
}

/** The status a given status moves to, or `null` if it is terminal. */
export function nextStatus(status: OrderStatus): OrderStatus | null {
  return NEXT[status];
}

export function canAdvance(from: OrderStatus, to: OrderStatus): boolean {
  return NEXT[from] === to;
}

/** Guards every status write. Returns the accepted status, or `null`. */
export function transition(
  from: OrderStatus,
  to: OrderStatus,
): OrderStatus | null {
  return canAdvance(from, to) ? to : null;
}

export interface StatusAction {
  to: OrderStatus;
  label: string;
  variant: "primary" | "secondary" | "highlight";
  /** Primary action is rendered larger/emphasised in the staff board. */
  primary: boolean;
}

/**
 * Buttons the staff board should render for a given status. Kept here (rather
 * than in the view) so the rules are unit-testable in isolation.
 */
export function actionsFor(status: OrderStatus): StatusAction[] {
  switch (status) {
    case "received":
      return [
        {
          to: "preparing",
          label: "Start preparing",
          variant: "primary",
          primary: true,
        },
      ];
    case "preparing":
      return [
        { to: "ready", label: "Mark ready", variant: "primary", primary: true },
      ];
    case "ready":
      // No "Complete" shortcut here. There used to be one, but ready ->
      // completed is not a legal hop — not in NEXT above, and not in
      // firestore.rules — so the tap was refused and silently did nothing.
      // Offering only buttons the machine accepts is pinned by a test.
      return [
        {
          to: "served",
          label: "Mark served",
          variant: "primary",
          primary: true,
        },
      ];
    case "served":
      return [
        {
          to: "completed",
          label: "Complete",
          variant: "primary",
          primary: true,
        },
      ];
    case "completed":
      return [];
  }
}

/** Customer-facing step list (§4.1 step 6). */
export const CUSTOMER_STEPS = [
  "received",
  "preparing",
  "ready",
  "served",
] as const satisfies readonly OrderStatus[];

export function stepIndex(status: OrderStatus): number {
  const i = (CUSTOMER_STEPS as readonly OrderStatus[]).indexOf(status);
  // `completed` means every customer-visible step happened
  return i === -1 ? CUSTOMER_STEPS.length - 1 : i;
}

export function isFinalForCustomer(status: OrderStatus): boolean {
  return status === "served" || status === "completed";
}
