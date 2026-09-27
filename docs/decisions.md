# Design decisions

The two spec documents ([`requirements.md`](./requirements.md) and
[`anime-theme.md`](./anime-theme.md)) each ended with open questions. This file
records the answers and the reasoning, so the "why" survives the handoff instead
of living in someone's head.

## 1. The three open questions in `requirements.md` §11

### "Should customers see live order status updates on their own screen, or just a confirmation?"

**Decision: yes, live.**

A customer's real question after ordering is _"is it coming?"_. A static
confirmation number makes them either ask the counter or get up and look, both of
which cost the cafe a staff interaction per table. Listening to their own order
document costs one Firestore read per open screen and removes that interaction
entirely.

Implemented at `/order/confirmation` via `onSnapshot` on the single order — not a
polling loop, and not a subscription to the whole orders collection, so a busy
service does not multiply a customer's read cost.

> Requirements §5.3 only _required_ the live listener for staff, but §4.1 step 6
> promised customers "live status: Received → Preparing → Ready/Served". This
> resolves that in favour of the customer-facing promise.

### "Single staff login shared across employees, or individual accounts?"

**Decision: individual accounts, with a shared-PIN convenience in demo mode only.**

Firestore rules can only enforce "this person may update orders" if there _is_ a
person. A shared login means a leaked password gives anyone write access to every
order and no way to attribute a mistake.

The compromise: `Firebase Authentication` email + password per employee, with the
role read from `/staff/{uid}` (the shape §8 already anticipates, marked "Phase 2
if role-based access needed" — it turned out to be needed immediately, because
menu management in §5.1 requires an owner role). A 4-digit PIN is available in
demo mode only, for a single counter phone in a rush; with real Firebase
configured, PIN sign-in is refused rather than quietly falling back to something
weaker.

### "Payment: pay-at-counter only for v1, or include UPI QR/payment link from day one?"

**Decision: pay-at-counter for v1, as §9 already scopes it.**

UPI deep links need either a PSP integration (a merchant account, a compliance
review, and a per-order reconciliation) or a static UPI QR on the table — and the
static QR is really a _feature request for the printed table card_, not a payment
gateway. That is cheap and worth doing in Phase 2 by printing a UPI block on the
back of the same tent card that `/admin/qr` already produces.

What v1 does include: `paymentMethod` on the order document, `upi` accepted as a
value, so enabling it later is a UI change and not a migration.

## 2. Deciding questions the specs left open

### Demo mode vs. "no app installs"

§2 asks for zero/low infrastructure cost and §3 for no installs, but a Firebase
project is still required to _use_ the product. Rather than shipping a system
nobody can see until they sign up for a cloud account, the app ships with a second
storage backend.

`src/lib/data/` defines the contracts (`MenuRepository`, `OrderRepository`,
`AuthRepository`, `ConfigRepository`) with two implementations:

|               | `demo/`                             | `firestore/`       |
| ------------- | ----------------------------------- | ------------------ |
| backing store | `localStorage` + `BroadcastChannel` | Firestore          |
| live updates  | cross-tab sync                      | `onSnapshot`       |
| auth          | fixed demo accounts                 | Firebase Auth      |
| loaded        | statically                          | dynamic `import()` |

Because the Firestore module is behind a dynamic import and the demo path is the
default, **a demo-mode visitor never downloads the Firebase SDK at all** — the
production first-load bundle is ~103 kB. Switching to Firestore is six env vars
and no code change.

The demo backend is not a stub. It is genuinely live across tabs, so a customer
phone and a staff phone opened side by side on one laptop behave exactly like the
real thing, and `scripts/flow.mjs` uses that property to walk the whole loop in
CI.

### The status machine

§5.3 specifies `preparing` → `completed`, "extendable to `ready`, `served` later",
while §4.1 promises customers `Received → Preparing → Ready/Served`. Those cannot
both be the whole truth, so the app takes the extension and defines one explicit
machine:

```
received → preparing → ready → served → completed
```

in [`src/lib/order-status.ts`](../src/lib/order-status.ts). Transitions are
forward-only and single-step, enforced in three independent places:

1. `transition()` in the app, so the UI cannot offer an illegal move;
2. `firestore.rules`, which enumerates the legal next status explicitly from the
   stored document rather than trusting the client;
3. the test suite, which walks the whole chain and asserts each hop.

`completed` is terminal and immutable. That is what satisfies §5.3's "keeps it in
the database for history — not deleted" and §5.4's six-month retention, and it is
why completed orders still appear in reports after they leave the staff board.

### Order totals: checked in the app, bounded in the rules, and not re-derived

Customers are unauthenticated (§3), so the phone sending the order is untrusted.
Two independent defences:

- **Client**, before writing: `priceCart()` in [`src/lib/money.ts`](../src/lib/money.ts)
  re-prices the basket against the live menu. A sold-out or deleted item is
  rejected outright; a price change is applied and shown, not blocked, because
  stranding a customer mid-checkout over ₹30 is worse than charging the current
  price. Totals are integer rupees — the cafe has no paise, and float sums on a
  menu are a rounding bug waiting to happen.
- **Server**, in `firestore.rules`: the `create` rule pins `status` to
  `preparing`, requires `createdAt == request.time` so a phone cannot backdate an
  order out of a reporting month, restricts the document to an exact field set so
  nothing extra can be injected, and requires `total` to be a bounded integer.

**The gap, stated plainly:** the rules cannot recompute the total. Firestore rules
have no loops, no lambdas and no `reduce`, so there is no way to sum a
variable-length basket in a rule, and an earlier version of this file claimed
otherwise. A customer with devtools can post `total: 1` for a real basket, and the
order will be accepted at that figure. `priceCart()` protects the honest path, not
the adversarial one.

The fix is a trusted backend, not a cleverer rule: a Firestore-triggered function
that rewrites `total` from the stored lines. That needs the Blaze plan, though
Cloud Functions 2nd gen includes 2M invocations/month free, which is far more than
a cafe uses — so it is affordable, just not free to enable. It remains open as
issue #27.

**What the free tier does instead: detection at the counter, not prevention.**
[`src/lib/order-integrity.ts`](../src/lib/order-integrity.ts) re-derives an order
from what is stored, and the staff board runs it on every ticket against the live
menu:

- `total` against the sum of the stored lines. The honest client always writes
  exactly that sum, so a mismatch has no innocent explanation.
- each line's unit price and name against the menu item it points at, and any
  line whose item is not on the menu at all.

A ticket that fails gets a red _"Total doesn't match menu — check before
charging"_ box listing what is wrong, the stored total struck through, and the
basket priced at today's menu — the figure to charge. Nothing is rewritten; the
forged order stays in the database as it was sent.

Why compare against the _current_ menu when lines deliberately store the price at
order time? Because the stored line price is exactly as untrusted as the total:
a forger who lowers both, consistently, passes the first check. The menu is the
only trusted price source the browser has. The cost is a false positive when the
owner edits a price while an order is on the board; that window is minutes, and
the message names both prices so the barista can tell a price change from a
forgery. Blocking or auto-correcting would be wrong for the same reason.

`/admin/reports` already adds revenue up from the line items, not the stored
totals, so a forged `total` alone does not move the figures. It lists any order
in the period whose total disagrees with its own items — the ones the counter may
have charged wrongly — and, as a softer hint, orders whose items differ from
today's menu, which for old orders is usually just a price change since. Until
the Blaze fix, reconcile those against the till.

`scripts/rules-test.mjs` pins the behaviour that _is_ enforceable: 28 assertions
covering the anonymous customer, a signed-in barista and a signed-in owner,
including that a barista cannot touch the menu and cannot skip a status.

### A hand-written QR encoder

§5.5 needs one static QR per table. A QR library is ~30 kB of JavaScript on the
page whose entire premise is loading fast on cafe wifi (theme doc §6), and the
payload is a ~45-character URL that fits comfortably in a small QR version.

[`src/lib/qr.ts`](../src/lib/qr.ts) implements ISO/IEC 18004 byte mode with
Reed–Solomon error correction and mask selection. Because a subtly wrong QR code
means printing ten cards that nobody can scan, the tests do not snapshot the
matrix — they **round-trip it through a real decoder** (`jsQR`) and assert the
original string comes back, for every table number the cafe is likely to have.

Scope is deliberately narrow and enforced: byte mode, ECC level M, versions 1–10.
Anything outside that throws rather than emitting an unscannable code.

### Reports are computed in the browser

§5.4 wants monthly revenue, order count, average order value, top sellers and
revenue by day. For 6–10 tables and ~100 orders/day, a month is a few hundred
documents — comfortably inside the Firestore free tier fetched once as a bounded
range query. Aggregating server-side (or adding Cloud Functions) would cost money
and buy nothing at this volume, and it would make the report page need its own
cold start. See `docs/decisions.md` §2 note on the free-tier ceiling in the
README.

The bar chart is CSS-only for the same reason the QR encoder is hand-written: no
charting library ships to the customer's phone.

### The mascot is original

Theme doc §4/§7 is explicit that the reference image's character is One Piece IP
and must not be reused. `src/components/Mascot.tsx` is a hand-authored SVG: big
round eyes, rosy cheeks, one ahoge, a terracotta scarf, a roasted-brown apron and
a coffee-bean hair clip. It is generated from the same markup into the PWA icon
set, so there is no binary art to keep in sync and no licence to track.

It is also a functional part of the UI, not decoration: it carries the loading
state, the empty state, the order confirmation and the sign-in gate, which is how
a chibi mascot earns its keep on a menu that must stay fast.

### Keeping the staff view boring

Theme doc §5 asks the staff board to be "more functional/less decorative", and
§7 warns against over-animating it. So the board has exactly one animation — a
three-flash border on a genuinely new order, paired with the chime and vibration
that §5.3 requires — and no mascot animation, no particles, and a small mascot
in the header only. Everything else is a card, a number, and a 44px button.

The wait timer turns amber at 4 minutes and berry red at 8, which is the only
"decoration" there is, and it is the thing a barista actually looks for.
