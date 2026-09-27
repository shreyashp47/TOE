"use client";

import { cn } from "@/lib/cn";
import { useEffect, useId, useRef, type ReactNode } from "react";

/**
 * Cart drawer (theme doc §5: "cart drawer/bottom sheet slides up with a
 * playful transition"). Rendered as a real dialog so focus trapping, Escape and
 * backdrop dismissal come for free.
 *
 * Kept dependency-free: no animation library, transforms only (theme doc §6).
 */
export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  labelId?: string;
}

export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  labelId,
}: SheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const headingId = useId();
  const id = labelId ?? headingId;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);

    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      {/* Redundant dismiss target for pointer users only: the real controls are
          Escape and the labelled close button, so this stays out of the a11y tree
          and out of the tab order. */}
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        onClick={onClose}
        className="absolute inset-0 animate-fade-in bg-[var(--scrim)]"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        tabIndex={-1}
        className={cn(
          "relative flex max-h-[88svh] animate-sheet-up flex-col",
          "rounded-t-xl border-t-2 border-line bg-cream shadow-sheet outline-none",
        )}
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b-2 border-line-soft px-4 py-3">
          <h2 id={id} className="text-xl">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close cart"
            className="-mr-1 grid size-11 shrink-0 place-items-center rounded-pill text-ink transition-colors hover:bg-tan"
          >
            <svg
              viewBox="0 0 24 24"
              width="22"
              height="22"
              aria-hidden="true"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.6"
              strokeLinecap="round"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
          {children}
        </div>

        {footer ? (
          <div className="safe-b shrink-0 border-t-2 border-line-soft bg-paper px-4 pt-3">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default Sheet;
