/**
 * UPI pay-at-table (docs/requirements.md §4.1 step 7, Phase 2, optional).
 *
 * This builds a `upi://pay` link with the order's amount filled in. On a phone,
 * tapping it opens whichever UPI app the customer uses (GPay, PhonePe, Paytm,
 * BHIM); the same text as a QR code lets someone at the table pay from a
 * different phone.
 *
 * What it is not: a payment integration. There is no gateway, no merchant
 * account and no callback, so the app never learns whether money moved. Staff
 * still confirm payment at the counter by looking at the customer's "paid"
 * screen, exactly as they would for a static UPI sticker by the till. That is
 * why the whole feature is off unless the owner sets `NEXT_PUBLIC_UPI_ID`.
 *
 * Link format: NPCI's "UPI Linking Specification" — `pa` (payee address),
 * `pn` (payee name), `am` (amount, rupees with two decimals), `cu` (always INR)
 * and `tn` (a note the customer sees in their app, and the cafe sees in its
 * statement).
 */

/** What the confirmation screen needs to render the "Pay by UPI" card. */
export interface UpiPayee {
  /** The cafe's UPI ID, e.g. `mochibeans@okaxis`. */
  address: string;
  /** Shown in the customer's app as who they are paying. */
  name: string;
}

/**
 * A UPI ID is `handle@psp`: the handle is letters, digits, dot, hyphen or
 * underscore (a phone number is a common one), and the PSP suffix is the bank
 * or app code (`okaxis`, `ybl`, `paytm`, `upi`). This is a shape check, not a
 * lookup — a well-formed ID can still belong to nobody, and only a test payment
 * of ₹1 proves it is right.
 */
const UPI_ID = /^[a-z0-9][a-z0-9._-]{1,255}@[a-z][a-z0-9]{1,63}$/i;

export function isValidUpiId(value: string): boolean {
  return UPI_ID.test(value.trim());
}

/**
 * Two decimals, always. The spec's examples write `240.00`, and matching them
 * exactly costs nothing — whereas finding out which app is strict about a bare
 * `240` would cost a customer standing at the counter.
 */
export function formatUpiAmount(rupees: number): string {
  if (!Number.isFinite(rupees) || rupees <= 0) {
    throw new Error("A UPI amount must be a positive number of rupees.");
  }
  return rupees.toFixed(2);
}

/**
 * The note shown in the customer's UPI app and on the cafe's bank statement, so
 * the owner can match a payment to a table later.
 *
 * Plain letters, digits and a hyphen on purpose. `Table 3 · Order #417` reads
 * better, but a `#` or a non-ASCII dot is exactly the kind of character a bank
 * app might refuse in a note, and we cannot test every app a customer might
 * have. Nothing here can be misread by any of them.
 */
export function upiNote(tableNumber: number, orderNumber: number): string {
  return `Table ${tableNumber} - Order ${orderNumber}`;
}

/**
 * Build the `upi://pay?…` link. Every value is percent-encoded, with one
 * exception: the `@` in the payee address is left as it is. That is how every
 * published UPI link writes it, so it is the form every app is sure to read; an
 * app that did not decode `pa` would otherwise look for a payee literally named
 * `name%40bank`. The address has already been checked against `UPI_ID`, so `@`
 * is the only character in it that encoding would change.
 *
 * Spaces become `%20`, never `+` — `+` is a form-encoding convention that some
 * apps would show as a literal plus sign in the payee name.
 */
export function buildUpiUri({
  payee,
  amount,
  note,
}: {
  payee: UpiPayee;
  amount: number;
  note: string;
}): string {
  const address = payee.address.trim();
  if (!isValidUpiId(address)) {
    throw new Error(`"${payee.address}" is not a valid UPI ID.`);
  }
  const params = [
    `pa=${encodeURIComponent(address).replace(/%40/g, "@")}`,
    `pn=${encodeURIComponent(payee.name.trim())}`,
    `am=${formatUpiAmount(amount)}`,
    `cu=INR`,
    `tn=${encodeURIComponent(note.trim())}`,
  ];
  return `upi://pay?${params.join("&")}`;
}

/**
 * Read the payee from the two optional env values. Returns `null` — and the
 * confirmation screen renders nothing UPI-related — when the ID is unset or is
 * not a valid UPI ID. A typo in the ID must not produce a working-looking
 * button that sends money nowhere, so an invalid one is treated as unset.
 *
 * The payee name falls back to the cafe name. It should match the name on the
 * bank account: several apps show a warning when it does not.
 */
export function readUpiPayee(
  rawId: string | undefined,
  rawName: string | undefined,
  fallbackName: string,
): UpiPayee | null {
  const address = (rawId ?? "").trim();
  if (!address || !isValidUpiId(address)) return null;
  const name = (rawName ?? "").trim() || fallbackName;
  return { address, name };
}
