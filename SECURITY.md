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
- **Money.** Order totals are recomputed from line items in two independent
  places — the app (`src/lib/money.ts`) and the Firestore `create` rule — because
  the sending device is not trusted. A bug in either is a high-severity finding.
- **Staff and owner accounts.** Email + password via Firebase Authentication,
  with the role read from `/staff/{uid}` and enforced by `firestore.rules`.
  A privilege-escalation path from `staff` to `owner` is high severity.
- **Customer order history.** Kept in `localStorage` per table, never synced. Not
  sensitive in the way a customer account would be, but it is still somebody's
  order.

## What is already handled

- Public users can **create** orders and **read** the menu. Nothing else. See
  `firestore.rules`.
- Order totals are re-derived server-side; `status` is pinned to `preparing` and
  `createdAt` is required to equal `request.time`, so a phone cannot backdate an
  order out of a reporting month or write a status directly.
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
