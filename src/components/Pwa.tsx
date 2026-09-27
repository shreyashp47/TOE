"use client";

/**
 * Service-worker registration + "add to home screen" hint.
 *
 * docs/requirements.md §3: "No app installs required for customers or staff
 * (mobile web / PWA)". A PWA install is offered, never required — the app is
 * fully usable in a plain browser tab.
 */

import { useCallback, useEffect, useState } from "react";

import { Mascot } from "@/components/Mascot";
import { Button } from "@/components/ui/Button";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const HINT_KEY = "cafe-qr-order.install-hint-dismissed.v1";

export function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    const register = () => {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
        /* offline support is a bonus, never a requirement */
      });
    };
    window.addEventListener("load", register);
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}

export function InstallHint({ appName }: { appName: string }) {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(
    null,
  );
  const [dismissed, setDismissed] = useState(true);
  const [standalone, setStandalone] = useState(true);

  useEffect(() => {
    let seen = false;
    try {
      seen = globalThis.localStorage?.getItem(HINT_KEY) === "1";
    } catch {
      seen = false;
    }
    setDismissed(seen);
    setStandalone(
      window.matchMedia("(display-mode: standalone)").matches ||
        // iOS Safari reports standalone differently
        (navigator as { standalone?: boolean }).standalone === true,
    );

    const onPrompt = (event: Event) => {
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  const dismiss = useCallback(() => {
    setDismissed(true);
    try {
      globalThis.localStorage?.setItem(HINT_KEY, "1");
    } catch {
      /* storage unavailable: the hint just reappears next visit */
    }
  }, []);

  if (!deferred || dismissed || standalone) return null;

  return (
    <div className="shell-wide mb-3">
      <div className="border-secondary/50 bg-highlight-soft/40 flex items-center gap-3 rounded-lg border-2 border-dashed p-3">
        <Mascot size={44} className="shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-ink font-semibold">Install {appName}</p>
          <p className="text-muted text-sm">
            Add it to your home screen for a full-screen board. No app store, no
            install required to use it.
          </p>
        </div>
        <Button
          size="sm"
          onClick={async () => {
            await deferred?.prompt();
            await deferred?.userChoice;
            dismiss();
          }}
        >
          Install
        </Button>
        <button
          type="button"
          onClick={() => void dismiss()}
          aria-label="Dismiss install hint"
          className="rounded-pill border-line bg-paper text-muted grid size-11 shrink-0 place-items-center border-2"
        >
          <svg
            viewBox="0 0 24 24"
            width="18"
            height="18"
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.6"
            strokeLinecap="round"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
    </div>
  );
}
