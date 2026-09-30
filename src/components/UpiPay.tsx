"use client";

/**
 * "Pay by UPI" on the order confirmation (Phase 2, optional — see
 * src/lib/upi.ts for what this is and, more importantly, what it is not).
 *
 * Two ways in, because the phone that ordered is not always the phone that
 * pays: a button that opens a UPI app on this phone, and a QR code of the same
 * link for a friend at the table to scan. Both carry the amount and the table,
 * so nobody types a number.
 *
 * The part that matters most is the plain sentence at the bottom. There is no
 * payment callback, so the counter cannot see a UPI payment — the customer has
 * to show it. Saying so on screen is what stops a customer walking out
 * believing the cafe already knows.
 */

import { useMemo } from "react";

import { Icon } from "@/components/icons";
import { buttonClassName } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { formatINR } from "@/lib/money";
import { qrToSvg } from "@/lib/qr";
import { buildUpiUri, upiNote, type UpiPayee } from "@/lib/upi";

export function UpiPay({
  payee,
  amount,
  tableNumber,
  orderNumber,
}: {
  payee: UpiPayee;
  amount: number;
  tableNumber: number;
  orderNumber: number;
}) {
  const uri = useMemo(() => {
    try {
      return buildUpiUri({
        payee,
        amount,
        note: upiNote(tableNumber, orderNumber),
      });
    } catch {
      // a zero total, say — nothing to pay, so no card
      return null;
    }
  }, [payee, amount, tableNumber, orderNumber]);

  const svg = useMemo(() => {
    if (!uri) return null;
    try {
      return qrToSvg(uri, { label: `UPI payment QR code for ${payee.name}` });
    } catch {
      // A very long payee name can outgrow the encoder's size range. The
      // button still works, so lose the QR rather than the whole card.
      return null;
    }
  }, [uri, payee.name]);

  if (!uri) return null;

  return (
    <Card className="p-4" data-upi="pay">
      <h2 className="text-lg">
        Pay by UPI <span className="text-muted text-sm">· optional</span>
      </h2>
      <p className="text-body mt-1 text-sm">
        Pay{" "}
        <span className="tnum text-ink font-semibold">{formatINR(amount)}</span>{" "}
        to <span className="text-ink font-semibold">{payee.name}</span> from
        your UPI app, or pay at the counter as usual.
      </p>

      <a
        href={uri}
        className={buttonClassName({ fullWidth: true, className: "mt-3" })}
      >
        <Icon name="check" size={18} />
        Pay {formatINR(amount)} with a UPI app
      </a>
      <p className="tnum text-2xs text-muted mt-1.5 text-center break-all">
        UPI ID: {payee.address}
      </p>

      {svg ? (
        <div className="border-line-soft mt-4 flex flex-col items-center gap-2 border-t-2 pt-4 text-center sm:flex-row sm:text-left">
          <div className="border-line-soft shrink-0 rounded-md border-2 bg-white p-2">
            <span
              className="block size-40"
              // Built on this phone by src/lib/qr.ts, like the table cards: no
              // QR image service sees the cafe's UPI ID or the amount.
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          </div>
          <p className="text-muted text-sm">
            Paying from another phone? Scan this with any UPI app. The amount
            and your table are already filled in.
          </p>
        </div>
      ) : null}

      <p
        className="border-line bg-highlight-soft/50 text-ink mt-4 rounded-md border-2 border-dashed px-3 py-2.5 text-sm"
        data-upi="counter-note"
      >
        <span className="font-semibold">
          Show the payment screen at the counter.
        </span>{" "}
        We don&apos;t get told when a UPI payment goes through, so the counter
        needs to see it to know you&apos;ve paid.
      </p>
    </Card>
  );
}
