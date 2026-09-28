# Changelog

Notable changes to this project. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Work that is built but not yet merged is tracked in
[docs/progress.md](./docs/progress.md).

## [Unreleased]

### Added

- Automatic deploys: every push to `main` that passes CI deploys the rules and
  hosting to toi-cafe, then checks the live site serves the new build
- The owner sets the cafe's tables on _/admin/qr_: a number of tables with −/+,
  or typed-out numbers with ranges (`1-8, 12, 14`). The list is saved to
  `config/tables` and the customer's table picker, the check on a scanned table
  number, and the printed QR cards follow it live. `NEXT_PUBLIC_TABLES` is now
  only the default until the owner saves a list

### Changed

- The app now lives at <https://toe-cafe.web.app>, a second Hosting site in the
  same `toi-cafe` project, since a project id cannot be renamed. The old
  address redirects every path there, query string included, so old links and
  QR codes keep working
- The owner goes straight to the owner dashboard after signing in on `/staff`;
  the Orders | Owner switch still opens the order board
- `/order` waits for the saved table list before judging a scanned table
  number, so a valid QR code is never briefly shown "that table number looks
  odd"
- `NEXT_PUBLIC_TABLES` ignores numbers above 50, which the order rules have
  always refused

### Security

- `config/tables` is owner-write only and shape-checked in the rules: only a
  `tables` field, a list of 1–50 entries whose first and last are whole numbers
  1–50. Other `config` documents are unchanged

### Changed

- The owner moves between the order board and the owner dashboard with a
  labelled **Orders | Owner** switch in the header, instead of an unlabelled
  chart icon (and a cart icon back). Baristas see no change

### Fixed

- Tapping between owner screens after a deploy could land on raw text at
  `/admin.txt`: pages and their router data are now revalidated on every load
  instead of cached for an hour, and the service worker fetches that data
  fresh and sends a tab stranded on a `.txt` back to its page

## [0.2.0] — 2026-09-28

Closes the two open holes in the rules, and fixes the service-worker cache, the
setup of staff accounts and the dead _Complete_ button. Deployed to
<https://toi-cafe.web.app> on 2026-09-28, rules and hosting together.

### Upgrading

- **Deploy rules and hosting together**, in one `firebase deploy`, at a quiet
  time. The shape of an order write changed: the old app against the new rules,
  or the reverse, refuses every order.
- **Reload the staff board** on the counter phone, and any open customer pages.
  An old board shows new orders as #0. From now on the app offers a _Reload_ bar
  when a new version is ready.
- **Order numbers are now 3 digits and not unique.** They are what a barista says
  out loud; the table is what tells two orders apart. Orders placed before this
  release keep their old number. The report CSV gains an _Order ID_ column — group
  by that, not by _Order #_.

### Added

- The staff board flags an order whose total does not match its lines or the
  current menu — "Total doesn't match menu — check before charging" — and
  _/admin/reports_ lists such orders
  ([#27](https://github.com/shreyashp47/TOE/issues/27))
- A signed-in account with no role gets a "your account isn't set up yet" screen
  with the exact command to fix it, and `npm run seed:staff` creates a staff or
  owner account and its role document in one command
  ([#33](https://github.com/shreyashp47/TOE/issues/33))
- `npm run cleanup:orders` counts orders older than six months, and deletes them
  with `--confirm`; it refuses any cutoff under six months
  ([#31](https://github.com/shreyashp47/TOE/issues/31))
- A _Reload_ bar when a new version of the app is ready, instead of a silent
  reload that would disarm the order chime
- An _Order ID_ column in the report CSV
- `docs/progress.md` — what is live, what is in flight, and what is waiting on a
  decision
- This changelog, issue and pull request templates

### Changed

- The order number is derived from the order's id (100–999) rather than taken
  from a shared counter ([#30](https://github.com/shreyashp47/TOE/issues/30))
- An order is written as one two-document batch with the customer's throttle
  stamp, instead of a read-then-write transaction
- The role is read from `/staff/{uid}` on every sign-in change, the same way the
  rules read it, instead of a cached guess that defaulted to staff
- Dependabot no longer opens a pull request per major version; majors are
  upgraded deliberately, one at a time. Security updates still arrive

### Fixed

- The service worker's cache version is stamped per build, so old caches are
  actually cleared ([#29](https://github.com/shreyashp47/TOE/issues/29))
- _Complete_ on a _Ready_ ticket did nothing; _Ready_ now offers only _Mark
  served_, and a failed status change says so on the ticket
- Firestore refusals showed customers the raw "Missing or insufficient
  permissions"; sign-in errors showed Firebase's developer text
- The "wait before ordering again" message no longer misjudges a phone whose
  clock disagrees with the server's
- The rules test suite counted any error as a denial; it now only counts
  `permission-denied`
- Docs no longer claim the rules recompute the order total, or that an order
  costs no reads

### Security

- Nobody can write the order counter any more; `/meta` is denied to everyone
  ([#30](https://github.com/shreyashp47/TOE/issues/30))
- Order creation is throttled in the rules to one per customer every 30 seconds
  ([#32](https://github.com/shreyashp47/TOE/issues/32)). A script that signs in
  afresh for each order is slowed only by Firebase Auth's limit on new accounts;
  App Check is the Blaze-plan follow-up

### Known issues

- The order total is still supplied by the customer's phone. The staff board now
  detects a mismatch, but preventing it needs a Cloud Function and so the Blaze
  plan ([#27](https://github.com/shreyashp47/TOE/issues/27))
- Six-month retention is an owner-run command, not automatic; a TTL policy or
  scheduled function needs Blaze
  ([#31](https://github.com/shreyashp47/TOE/issues/31))

## [0.1.0] — 2026-09-27

First version live on Firebase Hosting at <https://toi-cafe.web.app>, with the
customer, staff and owner flows verified end to end on the live site.

### Added

- Customer ordering from a table QR code: menu with category rail, cart sheet,
  order confirmation and a live status timeline — no app, no account
- Staff order board with live arrival, status actions and a new-order chime
- Owner menu management, monthly and date-range reports with CSV export, and
  printable per-table QR cards
- Zero-config demo mode backed by `localStorage`, live across browser tabs
- Installable PWA with an offline page
- Firestore security rules with an emulator test suite
- CI: lint, typecheck, unit tests, build, a self-check that proves the tests fail
  on a broken money rule, and a WCAG AA audit in Chromium and WebKit

### Fixed

- Customers can read back their own order through an anonymous sign-in, without
  opening the order book to everyone else
- The staff board no longer refuses its own status updates
- Tapping a table number opens the menu
- A dropped chunk request on flaky Wi-Fi no longer kills the page

### Known issues

- The order total is supplied by the customer's phone
  ([#27](https://github.com/shreyashp47/TOE/issues/27))
- The order counter is publicly writable
  ([#30](https://github.com/shreyashp47/TOE/issues/30))
- _Complete_ on a _Ready_ ticket does nothing

[Unreleased]: https://github.com/shreyashp47/TOE/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/shreyashp47/TOE/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/shreyashp47/TOE/releases/tag/v0.1.0
