# Progress

Where the project stands, what is in flight, and what is waiting on a decision.
Updated as work lands, so a fresh contributor — or a fresh session — can pick up
from here without reading the git log.

_Last updated: 2026-09-27_

## Live

**https://toi-cafe.web.app** — Firebase project `toi-cafe`.

Verified end to end on the live site on 2026-09-27, in a real browser at phone
width:

- Customer: table picker → menu → cart → order → confirmation with live status
- Staff: email sign-in → new orders arrive on the board in ~2 s with no reload →
  _Mark ready_ and _Mark served_ reach the customer's screen live
- Owner: menu edits reach customers immediately; reports match the orders; all
  six table QR codes decode to the right `/order?table=N` URL
- Signed-out visitors see no orders; one customer cannot read another's order;
  no console errors and no Firestore permission errors

One owner account exists. Baristas each need an account and a `/staff/{uid}`
document — see the README.

## In flight

Work is built on a branch, checked by a separate tester (locally, then on the
live site after deploy), and only then merged to `main`. Branches are pushed to
GitHub as they go, so nothing lives only on one machine.

| Branch               | Covers                    | State              |
| -------------------- | ------------------------- | ------------------ |
| `wip/rules-security` | #30, #32                  | Built — in testing |
| `wip/app-fixes`      | #29, #33, #27, #31, + bug | Building           |

- **#30** — the order counter is publicly writable. Moving to an order number
  that needs no shared writable document.
- **#32** — no limit on order creation. A per-customer throttle in the rules,
  using the anonymous uid. App Check is the Blaze-plan follow-up.
- **#29** — the service-worker cache version never changes. Stamped per build.
- **#33** — a signed-in account with no role sees an empty board. It will say so,
  and `npm run seed:staff` will create staff in one command.
- **#27** — the order total comes from the phone. The staff board will flag any
  order whose total does not match its lines. This is detection, not prevention;
  the issue stays open for the server-side fix.
- **#31** — six-month retention is not implemented. Reclassified as an operational
  practice, with an owner-run `npm run cleanup:orders` that dry-runs by default.
- **Bug** — _Complete_ on a _Ready_ ticket silently does nothing (the status
  machine offers a transition it then refuses). Found in live testing.

## Next

1. Merge the two branches above, deploy rules and hosting, re-test live
2. Dependabot majors (#22–#26): Next 16, TypeScript 7, ESLint 10, jsdom 30,
   Vitest coverage 5 — one at a time, each through the full checks
3. Phase 2 features that fit the free tier:
   - UPI pay-at-table (a `upi://` link and QR with the amount filled in)
   - Report export — CSV, and a print layout that saves as PDF
   - Keep the staff phone's screen awake while the board is open

## Waiting on the owner

- **UPI ID** for the cafe. Without it the payment screen ships switched off.
- **Blaze plan: yes or no.** Needed for the full fixes to #27, #31 and #32, push
  notifications with the screen off, emailed monthly reports, and dish photos
  (new Storage buckets need Blaze). Everything else stays on the free tier.

## Test data on the live site

Four test orders on Table 6 (#102–#105, ₹960 total) are completed and **count
in the September 2026 report**. Three older orders (Table 3 #101 and #102,
Table 5 #101) were still open at the time of testing; two share #101 because the
counter had been reset — the problem #30 fixes.

## Done

- 2026-09-27 — Staff and owner screens live; README updated (#28 closed)
