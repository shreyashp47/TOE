"use client";

import { useState } from "react";

import {
  useOrderingSettings,
  useSessionRepo,
} from "@/components/providers/DataProvider";
import { Card } from "@/components/ui/Card";
import { Switch } from "@/components/ui/Switch";
import { TABLE_OPEN_HOURS } from "@/lib/table-open";

/**
 * The owner's switch for staff confirming new guests (src/lib/table-open.ts),
 * saved to config/ordering. ON by default: a cafe that never opens this card
 * has the protection.
 */
export function NewGuestsSetting() {
  const repo = useSessionRepo();
  const { settings, loading } = useOrderingSettings();
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");
  const on = settings.confirmNewGuests;

  async function toggle(next: boolean) {
    if (!repo) return;
    setState("busy");
    try {
      await repo.saveSettings({ confirmNewGuests: next });
      setState("idle");
    } catch {
      setState("error");
    }
  }

  return (
    <Card className="p-4 print:hidden">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 basis-60">
          <h2 className="text-lg" id="confirm-new-guests">
            Confirm new guests before orders reach the kitchen
          </h2>
          <p className="text-muted mt-0.5 text-sm">
            A table&apos;s first order waits on the order board until staff see
            someone there and tap Accept; its next orders go straight through
            for {TABLE_OPEN_HOURS} hours. Stops orders from people who only have
            a photo of the QR code.
          </p>
        </div>
        <Switch
          checked={on}
          onChange={(next) => void toggle(next)}
          disabled={loading || state === "busy"}
          label={on ? "On" : "Off"}
          srContext="Confirm new guests before orders reach the kitchen"
        />
      </div>
      {!on ? (
        <p className="text-berry-deep mt-2 text-sm font-semibold">
          Off: anyone with a table&apos;s link can send an order straight to the
          kitchen.
        </p>
      ) : null}
      {state === "error" ? (
        <p role="alert" className="text-berry-deep mt-2 text-sm font-semibold">
          That didn&apos;t save. Try again.
        </p>
      ) : null}
    </Card>
  );
}
