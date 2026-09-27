"use client";

/**
 * New-order chime.
 *
 * Requirements.md §5.3 wants an audible/vibration alert, and the docs/anime-theme.md §5
 * insists it be more than a toast. WebAudio is used instead of an <audio> file
 * so there is nothing to download and nothing to ship — and because browsers
 * block audio until a user gesture, `unlock()` is wired to the first tap.
 */

import { useCallback, useEffect, useRef, useState } from "react";

const STORAGE_KEY = "cafe-qr-order.staff.muted.v1";

export function useOrderChime() {
  const [muted, setMuted] = useState(false);
  const [armed, setArmed] = useState(false);
  const ctxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    try {
      setMuted(globalThis.localStorage?.getItem(STORAGE_KEY) === "1");
    } catch {
      setMuted(false);
    }
  }, []);

  useEffect(() => {
    try {
      if (muted) globalThis.localStorage?.setItem(STORAGE_KEY, "1");
      else globalThis.localStorage?.removeItem(STORAGE_KEY);
    } catch {
      /* no-op */
    }
  }, [muted]);

  const context = useCallback(() => {
    if (typeof window === "undefined") return null;
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return null;
    ctxRef.current ??= new Ctor();
    return ctxRef.current;
  }, []);

  const unlock = useCallback(() => {
    const ctx = context();
    if (!ctx) return;
    if (ctx.state === "suspended") void ctx.resume();
    setArmed(true);
  }, [context]);

  /** Two-note bell: bright, short, and unmistakably a new order. */
  const chime = useCallback(() => {
    if (muted) return;
    const ctx = context();
    if (!ctx || ctx.state !== "running") return;

    const now = ctx.currentTime;
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    // quick attack, exponential decay — reads as a chime, not a beep
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.28, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.7);

    for (const [index, freq] of [880, 1320].entries()) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq;
      osc.connect(gain);
      osc.start(now + index * 0.14);
      osc.stop(now + 0.75);
    }
  }, [context, muted]);

  const buzz = useCallback(() => {
    // Only vibrate once the page has been interacted with — otherwise the
    // browser blocks the call and logs a console error for no benefit.
    if (muted || !armed) return;
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      try {
        navigator.vibrate([120, 60, 120]);
      } catch {
        /* unsupported */
      }
    }
  }, [muted, armed]);

  return { muted, setMuted, armed, unlock, chime, buzz };
}
