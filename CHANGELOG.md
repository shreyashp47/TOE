# Changelog

Notable changes to this project. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Work that is built but not yet merged is tracked in
[docs/progress.md](./docs/progress.md).

## [Unreleased]

### Added

- `docs/progress.md` — what is live, what is in flight, and what is waiting on a
  decision
- This changelog, issue and pull request templates
- Optional UPI pay-at-table: with `NEXT_PUBLIC_UPI_ID` set, the order
  confirmation shows a _Pay by UPI_ button and QR code with the amount and table
  filled in, and tells the customer to show the payment at the counter. Off by
  default; nothing UPI-related renders without it

### Fixed

- QR codes of version 7 and up (111+ bytes) did not scan: the encoder never
  wrote the version block. Table cards were too short to be affected

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

[Unreleased]: https://github.com/shreyashp47/TOE/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/shreyashp47/TOE/releases/tag/v0.1.0
