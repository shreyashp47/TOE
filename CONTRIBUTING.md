# Contributing

Thanks for helping. This is a small, self-contained project, so the bar is
mostly "keep it small and keep it honest".

## Getting set up

```bash
git clone https://github.com/shreyashp47/TOE.git
cd TOE
npm ci
npm run dev
```

Node 20.9+ (see `.nvmrc`). **No Firebase account is needed to work on this** —
with no env vars the app runs against the localStorage demo backend, which is
genuinely live across browser tabs.

## Before you open a PR

```bash
npm run verify
```

That runs lint → typecheck → tests → build, and it is the same sequence CI runs.
The `self-check` CI job is the one to know about: it deliberately breaks the
money calculation and fails if the test suite stays green. So if your change
touches money maths, order totals, the status machine, the QR encoder or report
aggregation, add or update a test that would fail without your change.

Two scripts check what a unit test cannot:

```bash
node scripts/screenshot.mjs   # every screen at 5 widths; fails on overflow
node scripts/audit.mjs        # WCAG A/AA, in Chromium *and* WebKit
node scripts/flow.mjs         # customer → staff → customer, end to end
```

Run `screenshot.mjs` after any styling change and **look at the PNGs**. It fails
on horizontal overflow, but it cannot tell you the card grid is ugly.

Run `audit.mjs` after any change to a colour. The palette is a fixed set of warm
mid-tones and several of them sit below the WCAG AA contrast floor on light
surfaces, so "it looks fine" is not good enough — two of them were only caught by
the audit. If you need text on terracotta, sage or berry, use the `-deep` variant
rather than lightening the background.

## House rules

These exist because of specific problems, not taste.

1. **Never hardcode a colour.** The palette is locked in
   `docs/anime-theme.md` §2 and lives in CSS variables in `src/app/globals.css`.
   Add a token there; don't put a hex in a component.

2. **Never trust the client for money.** Order totals are recomputed from line
   items in `src/lib/money.ts`, and the `create` rule in `firestore.rules`
   recomputes them server-side too. If you add a field that affects what a
   customer pays, it needs recomputing in both places.

3. **Status changes go through the machine.** Use `transition()` /
   `actionsFor()` from `src/lib/order-status.ts`, not a hand-written status
   string. The Firestore rules enforce the same transitions independently, and
   a test walks the whole chain.

4. **Keep the staff view functional.** Theme doc §5: the board is for speed
   during a rush. No new animation there without a reason a barista would
   notice mid-service.

5. **Add a runtime dependency reluctantly.** Theme doc §6: this app loads on
   cafe wifi and mobile data. The QR encoder and the report chart are both
   hand-written for exactly this reason. If you add one, say what it replaced and
   what it costs in bundle size.

6. **No licensed anime or manga IP.** The mascot is original, and must stay
   that way. Theme doc §7 is explicit.

7. **Never put body text on a mid-tone palette colour.** Use the `-deep` token
   variants. `node scripts/audit.mjs` will fail otherwise.

## Commit messages

Conventional Commits, one logical change per commit:

```
feat(staff): group the board by table when a rush starts
fix(money): recompute the total when an item is removed mid-session
test(qr): round-trip version 3 payloads through the decoder
docs: record the payment decision
```

## Pull requests

- Reference the issue it closes (`Closes #12`).
- Say what you verified — "ran `node scripts/flow.mjs`" is useful; "should work"
  is not.
- If it changes the UI, include a screenshot.
- Small PRs get reviewed. A 2,000-line PR that mixes a refactor with a feature
  will sit.

## Reporting a bug

Open an issue with what you did, what you expected, what happened, and your
phone/browser if it is layout-related. If the app is in demo mode, say so — the
console error that appears with Firebase configured is completely different.
