/**
 * The per-customer order throttle (issue #32), from the phone's side.
 *
 * The real limit lives in firestore.rules: every order must be written in the
 * same batch as the customer's /orderThrottle/{uid} document, and that document
 * may only be rewritten once ORDER_GAP_SECONDS have passed since the last one.
 * A script that loops on order creation is refused by the server whatever this
 * file says.
 *
 * What this file is for is the honest customer who taps "Place order" twice, or
 * remembers the sugar ten seconds later. The server's answer to them is a bare
 * "permission-denied", which would surface as "We couldn't send that order". So
 * the phone keeps its own note of when it last ordered and says, in plain words,
 * how long to wait — before the request, not after it fails.
 *
 * It runs in demo mode too, so the demo behaves the way the real app does.
 */

/** Must match `duration.value(…, 's')` in firestore.rules. A test checks it. */
export const ORDER_GAP_SECONDS = 30;

const KEY = "toe.lastOrderAt";

export class OrderThrottled extends Error {
  readonly seconds: number;
  constructor(seconds: number) {
    super(throttleMessage(seconds));
    this.name = "OrderThrottled";
    this.seconds = seconds;
  }
}

/** Whole seconds until another order is allowed; 0 means go ahead. */
export function secondsUntilNextOrder(
  lastOrderAt: number | null,
  now: number,
  gapSeconds: number = ORDER_GAP_SECONDS,
): number {
  if (lastOrderAt === null || !Number.isFinite(lastOrderAt)) return 0;
  const elapsed = now - lastOrderAt;
  // A last-order time in the future means the clock moved backwards. Waiting
  // the full gap is the safe reading; the server has the real clock anyway.
  if (elapsed < 0) return gapSeconds;
  const remainingMs = gapSeconds * 1000 - elapsed;
  return remainingMs > 0 ? Math.ceil(remainingMs / 1000) : 0;
}

export function throttleMessage(seconds: number): string {
  const s = Math.max(1, Math.ceil(seconds));
  return `Your last order has only just gone through. You can send another in ${s} second${s === 1 ? "" : "s"}.`;
}

export function readLastOrderAt(): number | null {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    const value = raw ? Number(raw) : NaN;
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

export function recordOrderPlaced(at: number): void {
  try {
    globalThis.localStorage?.setItem(KEY, String(at));
  } catch {
    /* private mode: the server still enforces the gap */
  }
}

/** Used by tests. */
export function forgetLastOrder(): void {
  try {
    globalThis.localStorage?.removeItem(KEY);
  } catch {
    /* nothing to forget */
  }
}
