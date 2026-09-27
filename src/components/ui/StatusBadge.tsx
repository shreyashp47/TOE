import { cn } from "@/lib/cn";
import { ORDER_STATUSES, type OrderStatus } from "@/lib/order-status";

const LOOK: Record<
  OrderStatus,
  { label: string; emoji: string; className: string }
> = {
  received: {
    label: "Received",
    emoji: "📝",
    className: "bg-tan text-ink border-line",
  },
  preparing: {
    label: "Preparing",
    emoji: "🔥",
    className: "bg-highlight-soft text-primary-dark border-highlight",
  },
  ready: {
    label: "Ready",
    emoji: "☕",
    className: "bg-sage-soft text-sage border-sage",
  },
  served: {
    label: "Served",
    emoji: "✨",
    className: "bg-sage text-on-dark border-sage",
  },
  completed: {
    label: "Completed",
    emoji: "✓",
    className: "bg-tan-deep text-primary-dark border-tan-deep",
  },
};

export function StatusBadge({
  status,
  size = "md",
  className,
}: {
  status: OrderStatus;
  size?: "sm" | "md";
  className?: string;
}) {
  const look = LOOK[status];
  return (
    <span
      data-status={status}
      className={cn(
        "rounded-pill font-round inline-flex shrink-0 items-center gap-1 border-2 font-semibold",
        look.className,
        size === "sm" ? "text-2xs px-2.5 py-0.5" : "px-3 py-1 text-sm",
        className,
      )}
    >
      <span aria-hidden="true">{look.emoji}</span>
      {look.label}
    </span>
  );
}

export function statusLabel(status: OrderStatus): string {
  return LOOK[status].label;
}

export function statusEmoji(status: OrderStatus): string {
  return LOOK[status].emoji;
}

export { ORDER_STATUSES };
export default StatusBadge;
