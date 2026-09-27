# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for a security problem.

Email the maintainer, or use GitHub's private reporting on the Security tab of
the repository. Include what you found, how to reproduce it, and the impact you
believe it has.

You can expect an acknowledgement within a few days.

## What this project handles

Worth knowing when judging severity:

- **Unauthenticated writes.** Customers place orders with no login, by design
  (`docs/requirements.md` §3). Anything reachable without a session is in scope
  for a hostile user, not just a careless one.
- **Money.** `src/lib/money.ts` re-prices every basket against the live menu, and
  `firestore.rules` type-checks and bounds the total. But the rules language cannot
  recompute a total (no loops, no lambdas), so a tampered client **can** post a
  false `total` and have it accepted. The staff board re-derives every order from
  its lines and the live menu and flags a mismatch before payment
  (`src/lib/order-integrity.ts`) — detection at the counter, not prevention in
  the database. A bug in the pricing maths, in that check, or a report built on a
  forged total, is high severity.
- **Staff and owner accounts.** Email + password via Firebase Authentication,
  with the role read from `/staff/{uid}` and enforced by `firestore.rules`.
  A privilege-escalation path from `staff` to `owner` is high severity.
- **Owner scripts.** `npm run seed:staff` runs on the owner's own machine with
  the OAuth token from their `firebase login`, so it acts as the project's owner
  over IAM and `firestore.rules` does not apply to it. It is only as safe as that
  laptop's login. Nothing in it ships to a browser, and it stores neither a
  credential nor the password it generates.
- **Anonymous customers.** A customer signs in anonymously and the order rules
  scope reads to `resource.data.customerUid == request.auth.uid`. So the customer
  read path is a real security boundary: any change that makes `isStaff()` true
  for an anonymous user exposes the entire order book. Membership is by presence
  of a `/staff/{uid}` document, so the default is closed.
- **Customer order history.** Kept in `localStorage` per table, never synced. Not
  sensitive in the way a customer account would be, but it is still somebody's
  order.

## What is already handled

- Public users can **create** orders and **read** the menu. Nothing else, apart
  from the throttle stamp on their own `/orderThrottle/{uid}` that must accompany
  each order (below). See `firestore.rules`. (Until issue #30 there was one more thing: a
  world-writable `/meta/counters` order counter. It is gone; the display number
  is derived from the order id, and `/meta` is denied to everyone.)
- `status` is pinned to `preparing` on create, `createdAt` is required to equal
  `request.time` so a phone cannot backdate an order out of a reporting month, and
  the document is restricted to an exact field set.
- Status transitions are enumerated in the rules, so a staff account cannot skip a
  state or edit a price after the order is placed.
- **Not handled:** the order `total` is client-supplied and is not re-derived
  server-side. It is re-derived on the staff board, and a mismatch is flagged
  there, but the forged figure is still stored. See the money bullet above — this
  is a known gap, tracked in issue #27, whose real fix needs the Blaze plan.
- Order creation is throttled to **one order per anonymous uid per 30 seconds**.
  The order must be written in the same batch as a stamp on
  `/orderThrottle/{uid}` naming that order, and the rules refuse the stamp inside
  the gap. The stamp cannot be deleted, backdated, or written for somebody
  else's uid, and one stamp cannot carry two orders.
- **Not handled:** a script that mints a fresh anonymous uid for every order is
  only slowed by Firebase Auth's per-IP limit on new accounts, not stopped. The
  purpose-built fix is Firebase App Check, which needs the Blaze plan and is not
  enabled. A bypass of the per-uid throttle that does not involve minting new
  uids is in scope.
- Completed orders are immutable, so history cannot be rewritten.
- The Firebase SDK is never loaded unless the Firebase env block is set, and it
  is never used to hold a secret — the config values are public by design.
- `dependencies` are covered by Dependabot, and CI fails on lint, typecheck,
  tests and a production build.

## Deployment notes for the owner

The one thing that is easy to get wrong: **`firebase deploy --only
firestore:rules,firestore:indexes`**. A Firestore database left in test mode
lets anyone who knows the project id read and write everything, which for this
app means reading other people's orders and writing their own at any price.

If you have deployed, confirm it took effect:

```bash
firebase firestore:databases:get-default
```

and check that the rules in the console match `firestore.rules` in this repo.
