# Progress

Where the project stands, what is in flight, and what is waiting on a decision.
Updated as work lands, so a fresh contributor — or a fresh session — can pick up
from here without reading the git log.

_Last updated: 2026-09-28_

## Live

**https://toi-cafe.web.app** — Firebase project `toi-cafe`.

**v0.2.0** deployed on 2026-09-28, rules and hosting together (service-worker
cache version `727acf676c24`). See the [changelog](../CHANGELOG.md) for what
changed and the upgrade steps.

v0.2.0 was verified on the live site on 2026-09-28 at phone width, as a customer
and a signed-out visitor:

- Order on Table 6 → confirmation with live status; no console or permission
  errors; `sw.js` carries the stamped cache version
- A second order within 30 s is refused with a countdown; after 30 s it goes
  through (#32)
- `meta/counters` cannot be read or written; an order carrying its own number,
  or skipping the throttle stamp, is refused; signed-out and anonymous visitors
  cannot list orders or read another customer's (#30)
- `/staff` and `/admin` show only sign-in screens when signed out

**Not yet checked live:** the staff board and owner screens signed in (the new
3-digit numbers, the total-mismatch flag, the no-role message). Needs someone
with a staff or owner login.

v0.1.0 was verified end to end on the live site on 2026-09-27: customer order
to confirmation with live status, staff board receiving orders in ~2 s, owner
menu edits, reports and QR codes, and no cross-customer reads.

One owner account exists. Baristas each need an account and a role document:
`npm run seed:staff -- --email=… --role=staff` — see the README.

## In flight

Work is built on a branch, checked by a separate tester (locally, then on the
live site after deploy), and only then merged to `main`. Branches are pushed to
GitHub as they go, so nothing lives only on one machine.

| Branch         | Covers           | State                                             |
| -------------- | ---------------- | ------------------------------------------------- |
| `feat/stage-2` | UPI pay-at-table | Built, uncommitted — waiting on the cafe's UPI ID |

## Next

1. Dependabot majors ([#34](https://github.com/shreyashp47/TOE/issues/34)) —
   Next 16, TypeScript 7, ESLint 10, jsdom 30, Vitest coverage 5 — one at a
   time, each through the full checks
2. The rest of Phase 2 that fits the free tier:
   - Report print layout that saves as PDF
   - Keep the staff phone's screen awake while the board is open
3. UPI pay-at-table, once the cafe's UPI ID arrives

## Waiting on the owner

- **UPI ID** for the cafe. Without it the payment screen ships switched off.
- **Blaze plan: yes or no.** Needed for the full fixes to #27, #31 and #32, push
  notifications with the screen off, emailed monthly reports, and dish photos
  (new Storage buckets need Blaze). Everything else stays on the free tier.

## Test data on the live site

Four test orders on Table 6 (#102–#105, ₹960 total) are completed and **count
in the September 2026 report**. Three older orders (Table 3 #101 and #102,
Table 5 #101) were still open at the time of testing; two share #101 because the
old counter had been reset. Those keep their stored numbers. Orders placed since
v0.2.0 use a 3-digit number derived from the order id, which is not unique —
use the table, or the _Order ID_ column in the CSV, to tell orders apart.

Three more test orders on Table 6 from the 2026-09-28 live test (#826, #315,
#156; one Cappuccino each, ₹540 total) are still _preparing_. Complete or delete
them from the owner account before relying on the September report.

## Done

- 2026-09-28 — v0.2.0 live: #29 #30 #32 #33 closed; #27 detection shipped, #31
  owner-run cleanup
- 2026-09-27 — Staff and owner screens live; README updated (#28 closed)
