# Cafe QR Ordering System

Customers scan a QR code on their table, browse the menu on their own phone, and
place an order with no app to install. Staff see new orders appear live on a
counter phone. The owner edits the menu and reads the monthly numbers — without a
developer.

Built for a 6–10 table cafe on free-tier infrastructure.

<!-- prettier-ignore -->
| | |
|---|---|
| **Stack** | Next.js 15 (App Router) · TypeScript · Tailwind CSS v4 · Firebase (Firestore + Auth) |
| **Hosting** | Firebase Hosting — free `*.web.app` subdomain, optional custom domain |
| **Live updates** | Firestore `onSnapshot` — no polling loops, no separate realtime service |
| **Install** | Nothing to install. Optional PWA for the staff phone. |
| **Cost** | Free tier. A custom domain is the only expected expense (~₹500–800/year). |
| **Docs** | [Requirements](./docs/requirements.md) · [Theme](./docs/anime-theme.md) · [Decisions](./docs/decisions.md) |

### Live deployment

**https://toi-cafe.web.app** — Firebase project `toi-cafe`, Firestore in
`asia-south1`, 12 menu items seeded.

| Screen             | URL                                     | State                                       |
| ------------------ | --------------------------------------- | ------------------------------------------- |
| Customer menu      | `/order?table=1` … `/order?table=6`     | Working — browse, order, live status        |
| Table picker       | `/`                                     | Working                                     |
| Order confirmation | `/order/confirmation?table=3&id=…`      | Working                                     |
| Staff board        | `/staff`                                | Needs Email/Password + a `/staff/{uid}` doc |
| Owner              | `/admin`, `/admin/reports`, `/admin/qr` | Needs the same                              |
| Offline            | `/offline`                              | Working                                     |

The customer half needs no account and is usable as-is. The staff half is
blocked on two console steps — see [Going live](#going-live-with-firebase).

---

## Quickstart

```bash
git clone https://github.com/shreyashp47/TOE.git
cd TOE
npm ci
npm run dev
```

Open <http://localhost:3000>. That is the whole setup — **no Firebase account
needed.** The app boots in demo mode with a full sample menu and a local storage
backend, and a banner says so.

To see the whole loop, open two tabs:

1. <http://localhost:3000/order?table=3> — the customer's phone
2. <http://localhost:3000/staff> — the staff phone (PIN `1122`)

Place an order in the first tab. It appears in the second **without a refresh**,
and when staff tap _Mark ready_, the customer's status screen updates live.

### Demo sign-ins

| Screen           | Credentials                    |
| ---------------- | ------------------------------ |
| `/staff`         | PIN `1122`                     |
| `/staff`         | `staff@demo.cafe` / `cafe1122` |
| `/admin` (owner) | `owner@demo.cafe` / `cafe1122` |

Demo data lives in this browser only. Clearing site data resets it; the owner
screen has a _Reset samples_ button.

---

## Screens

Everything below is a real screenshot at phone width, from the demo build.

<table>
<tr>
<td width="33%"><img src="docs/screens/01-order.png" alt="Customer menu with category rail and card grid"></td>
<td width="33%"><img src="docs/screens/02-cart.png" alt="Cart bottom sheet with quantity steppers"></td>
<td width="33%"><img src="docs/screens/03-status.png" alt="Order confirmation with a live status timeline"></td>
</tr>
<tr>
<td align="center"><em>Menu — categories, prices, sold-out state</em></td>
<td align="center"><em>Cart — steppers, live total, consent gate</em></td>
<td align="center"><em>Status — updates live, no refresh</em></td>
</tr>
<tr>
<td width="33%"><img src="docs/screens/04-staff-board.png" alt="Staff live order board"></td>
<td width="33%"><img src="docs/screens/05-reports.png" alt="Monthly revenue report"></td>
<td width="33%"><img src="docs/screens/06-qr-cards.png" alt="Printable per-table QR cards"></td>
</tr>
<tr>
<td align="center"><em>Staff board — oldest first, wait timer</em></td>
<td align="center"><em>Reports — revenue, chart, best sellers</em></td>
<td align="center"><em>QR — one printable card per table</em></td>
</tr>
</table>

### Routes

| Route                              | Who      | What it does                                                  |
| ---------------------------------- | -------- | ------------------------------------------------------------- |
| `/order?table=N`                   | Customer | Menu with category rail, cart bottom sheet, place order       |
| `/order/confirmation?table=N&id=…` | Customer | Order number and live `Received → Preparing → Ready → Served` |
| `/staff`                           | Staff    | Live order board, status actions, sound + vibration alert     |
| `/admin`                           | Owner    | Menu management, availability toggles, today's special        |
| `/admin/reports`                   | Owner    | Monthly / custom-range revenue, AOV, best sellers, CSV        |
| `/admin/qr`                        | Owner    | Printable QR tent card per table                              |
| `/offline`                         | Anyone   | Service-worker fallback when the wifi drops                   |

---

## Going live with Firebase

The app is designed so this step cannot break the build: no code changes, six
environment variables.

> **For the `toi-cafe` deployment in this repo, sections 1, 2 and 5 are already
> done** — the project, the database, the web app, the hosted site and the
> deployed rules. What is left is the Auth setup in section 3, and the accounts in
> section 4. Start at section 3 if you are working on this deployment.

### 1. Create the project

1. [Firebase console](https://console.firebase.google.com) → **Add project** (the
   Spark plan is free).
2. **Build → Firestore Database → Create database.**
   - Start in **production mode** — the rules in this repo are the real ones.
   - Choose a region **near the cafe** (asia-south1 for India).
3. **Build → Authentication → Get started.** Enable **Anonymous** and
   **Email/Password** — both are required, and the reasons are not obvious.
   - **Anonymous** is what lets a customer read their own order back. The rules
     scope reads to `resource.data.customerUid == request.auth.uid`, and without
     it a customer who places an order is shown "we can't find that order" — see
     the note in section 3.
   - **Email/Password** is for staff and owners.
4. **Project settings → Your apps → Web →** copy the six `firebaseConfig` values.

### 2. Point the app at it

```bash
cp .env.example .env.local
```

Fill in the Firebase block:

```ini
NEXT_PUBLIC_FIREBASE_API_KEY=…
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=yourcafe.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=yourcafe
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=yourcafe.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=…
NEXT_PUBLIC_FIREBASE_APP_ID=…
```

Optionally brand it and pin the tables:

```ini
NEXT_PUBLIC_CAFE_NAME="Mochi & Beans"
NEXT_PUBLIC_TABLES=1,2,3,4,5,6,7,8
NEXT_PUBLIC_BASE_URL=https://yourcafe.web.app
```

Restart `npm run dev`. The demo banner disappears and the app talks to Firestore.

> **Why this is safe:** the Firebase SDK is behind a dynamic `import()`, so it is
> never downloaded unless these variables are present. A demo-mode visitor gets a
> ~103 kB first load with no cloud code in it at all.

### 3. Create staff and owner accounts

Authentication is email + password, so make the accounts first. The quickest
route is a temporary sign-up screen or the Firebase console
(**Authentication → Users → Add user**).

Then give the owner their role, which is what `firestore.rules` checks:

```json
// /staff/{uid}
{ "name": "Cafe Owner", "role": "owner" }
```

**Every account needs a document here, not just owners.** A missing document now
means "not staff", and that is deliberate: customers sign in anonymously so the
rules can let each one read back its own order, and a rule that treated "any
signed-in user" as staff would hand the whole order book to everyone who scans a
QR code. So add a `/staff/{uid}` document for each barista too:

```json
// /staff/{uid}
{ "name": "Asha", "role": "staff" }
```

`role` may be `staff` (works the board) or `owner` (also edits the menu and sees
the reports). An account with no document can sign in but sees nothing — a
closed default, which is the right way round for a database of orders.

### 4. Seed the menu

Create your first item in `/admin`, or add a temporary seeding snippet in
`src/lib/data/seed.ts` to the Firestore path. The sample menu's structure —
`name`, `description`, `price`, `category`, `available`, `sortOrder` — is exactly
the `/menu/{itemId}` document from the requirements.

### 5. Deploy the app

The app is a **static export** (`output: "export"` in `next.config.ts`), so it can
be served by Firebase Hosting with no Node runtime. That is safe here: there are
no route handlers, no server actions and no dynamic rendering, so all nine routes
prerender to plain HTML and every piece of data is fetched in the browser.

```bash
npm i -g firebase-tools
firebase login
firebase use --add          # pick your project; this writes .firebaserc
npm run build              # emits ./out
firebase deploy            # hosting + firestore rules + indexes
```

You land on `https://<project-id>.web.app`. `firebase.json` sets `cleanUrls`, so
`/order` is served from `out/order.html` and the printed QR URLs work unchanged.

#### Check the live site, not just the deploy output

`firebase deploy` reporting success does not mean the app works — a rule that
refuses a read, or a query missing an index, both fail silently at the browser.
Drive the real thing:

```bash
BASE_URL=https://toi-cafe.web.app npm run test:entry   # every way a customer reaches the menu
BASE_URL=https://toi-cafe.web.app npm run flow          # order -> staff board -> live status
BASE_URL=https://toi-cafe.web.app npm run audit         # contrast + WebKit, both engines
```

`test:entry` is the one that catches the class of bug that hides best. Tapping a
table number is a client-side navigation, so a hook that reads the query string
once on mount will look correct for every scanned QR code and wrong for every
tap. Both used to end on the same URL and show different screens.

To confirm the database side, with the console open in another tab:

```bash
npm run emulators    # terminal 1
npm run test:rules   # terminal 2 — 35 assertions, 0 failures
```

**Verify before you trust it** — the emulator applies the real routing and header
rules from `firebase.json`, with no account needed:

```bash
npm run build
firebase emulators:start --only hosting
```

Then check that `/`, `/order?table=3`, `/staff`, `/admin/reports` and `/sw.js` all
return 200, and that a 404 still returns 404.

To attach a custom domain later, add it under **Hosting → Add custom domain**. The
QR codes do not need regenerating as long as `/order?table=N` keeps working, which
is why `NEXT_PUBLIC_BASE_URL` exists if you want to print cards against a staging
address first.

> **The security headers are declared twice, on purpose.** `next.config.ts` has the
> `headers()` block for `next start`, and `firebase.json` re-declares the same
> values, because Next _silently discards_ `headers()` when exporting. It prints a
> warning during the build but ships the site without them. Firebase sends
> `no-store` for everything by default too, which would re-download every hashed
> chunk on each visit and defeat the 103 kB budget — so `firebase.json` also pins
> `/_next/static/**` to `max-age=31536000, immutable`. If you change a header in one
> place, change it in both.

<details>
<summary>Vercel instead (one-line alternative)</summary>

Push the repo, import it at [vercel.com/new](https://vercel.com/new), and add the
same six `NEXT_PUBLIC_FIREBASE_*` values under **Settings → Environment Variables**
for all three environments. Vercel runs the Next.js runtime, so it honours
`headers()` directly and `output: "export"` is simply ignored. Note that
`NEXT_PUBLIC_*` values are baked in at build time, so editing one later needs a
redeploy, not just a restart.

</details>

### "A tree hydrated but some attributes of the server rendered HTML didn't match"

Look at the attributes in the error before changing any code. If you see
`data-gr-ext-installed` or `data-new-gr-c-s-check-loaded`, that is **Grammarly**,
not this app. Writing extensions stamp helper attributes onto `<body>` before
React hydrates, and React cannot patch attributes it did not render.

It only ever appears in `npm run dev`, as a red overlay. A production build with
the same extension installed serves the page with no error at all.

Turn the extension off for `localhost` (Grammarly → Settings → More Settings →
Application exclusions) or use a private window. No code change is needed, and
none should be made: suppressing it would also hide genuine server/client
mismatches, which are worth seeing.

### If the build fails with "An error occurred in `next/font`"

`next/font/google` downloads the font files from Google **at build time**. On a
flaky connection it fails with an unhelpful `TypeError: Cannot read properties of
null` from the font loader, which looks like a code bug but is not one.

Just build again — it caches after the first success. CI already retries once
automatically.

If you are deploying from somewhere with unreliable internet, self-host the fonts
instead: download the woff2 files for Caveat (600, 700), Fredoka (500, 600) and
Nunito (400, 600, 700) into `public/fonts`, and swap the three `next/font/google`
calls in `src/app/layout.tsx` for `next/font/local`. The CSS variables and every
component stay exactly as they are — nothing else in the app knows which loader
produced the font.

### What the rules cannot do

Worth reading before you rely on the money figures.

`firestore.rules` is a real boundary, not a formality: `scripts/rules-test.mjs`
runs 28 assertions against the emulators covering the anonymous customer, a
signed-in barista and a signed-in owner. A barista cannot edit the menu, cannot
read another barista's role record, cannot skip a status and cannot change a
price after the order is placed.

But the rules language has **no loops and no lambdas** — there is no `reduce` and
no `function` expression. So a rule cannot sum a variable-length basket, which
means:

- `status`, `createdAt`, the field set and the shape of every line **are** enforced
  server-side.
- The `total` is **not**. It is checked to be a bounded integer, not to be correct.
  A customer with devtools could post `total: 1` for a real basket and it would be
  accepted.

For a single cafe the exposure is small: the attacker can only understate what
they owe, it is visible on the staff board, and `priceCart()` stops the honest
client from ever producing a wrong total. If you need it airtight, add a
Firestore-triggered function that rewrites `total` from the stored lines. That
requires the Blaze plan, but Cloud Functions 2nd gen includes 2M invocations a
month free — far more than a cafe uses.

### Deploy the rules too — this is the part people skip

```bash
firebase deploy --only firestore:rules,firestore:indexes
```

Without this, Firestore's default "test mode" rules leave the database readable
and writable by anyone with the project id. The rules in this repo are what make
§6's security requirement true: the public can **create** orders and **read** the
menu, and nothing else. See the comments in [`firestore.rules`](./firestore.rules)
for each clause.

---

## How it works

```
Customer phone                     Counter phone                  Owner
──────────────                     ─────────────                  ─────
scan /order?table=3 ──┐
                      │   ┌── onSnapshot(status != completed)
browse menu           │   │         │
add to cart (per      │   │    staff board
 table, survives      │   │      │  tap: Preparing → Ready → Served → Completed
 a reload)            │   │      │
place order ──────────┴───┴──────┘
   │
   └── onSnapshot(own order) ── live status on the customer's screen
```

| Concern             | Where it lives                                             |
| ------------------- | ---------------------------------------------------------- |
| Storage contracts   | [`src/lib/data/types.ts`](./src/lib/data/types.ts)         |
| Firestore adapter   | [`src/lib/data/firestore.ts`](./src/lib/data/firestore.ts) |
| Demo adapter        | [`src/lib/data/`](./src/lib/data)                          |
| Status machine      | [`src/lib/order-status.ts`](./src/lib/order-status.ts)     |
| Money + order maths | [`src/lib/money.ts`](./src/lib/money.ts)                   |
| Cart reducer        | [`src/lib/cart.ts`](./src/lib/cart.ts)                     |
| Report aggregation  | [`src/lib/reports.ts`](./src/lib/reports.ts)               |
| QR encoder          | [`src/lib/qr.ts`](./src/lib/qr.ts)                         |
| Theme tokens        | [`src/app/globals.css`](./src/app/globals.css)             |
| Mascot + icons      | [`src/components/`](./src/components)                      |
| Security rules      | [`firestore.rules`](./firestore.rules)                     |

Two rules worth knowing before you change anything:

1. **Never hardcode a colour.** The palette is locked by
   [`docs/anime-theme.md`](./docs/anime-theme.md) §2 and lives in CSS variables.
   Add a token; don't add a hex to a component.
2. **Money is only partly server-checked, and you should know where the gap is.**
   `firestore.rules` can bound and type-check a total but **cannot recompute it**
   — the rules language has no loops and no lambdas, so an arbitrary-length
   basket cannot be summed server-side. The total is therefore client-supplied.
   See [the limits section](#what-the-rules-cannot-do) before you rely on it.

---

## Quality gates

```bash
npm run verify     # lint → typecheck → test → build
```

| Command                 | What it does                                         |
| ----------------------- | ---------------------------------------------------- |
| `npm run dev`           | Dev server                                           |
| `npm run preview`       | Serve the production export exactly as Firebase does |
| `npm run test:rules`    | Attack `firestore.rules` (needs `npm run emulators`) |
| `npm run lint`          | ESLint 9, `next/core-web-vitals` + TypeScript rules  |
| `npm run typecheck`     | `tsc --noEmit`, `strict`                             |
| `npm test`              | Vitest + Testing Library, 189 tests                  |
| `npm run test:coverage` | Coverage, fails below 70% on all four metrics        |
| `npm run build`         | Production build                                     |
| `npm run format`        | Prettier, incl. Tailwind class sorting               |

There are also three Playwright scripts for checking things a unit test cannot:

```bash
node scripts/screenshot.mjs            # every screen at 320/390/430/768/1280 px
node scripts/audit.mjs                 # WCAG A/AA + WebKit (Safari/iOS)
node scripts/flow.mjs                  # customer → staff → customer, end to end
```

- **`screenshot.mjs`** fails on any console error **and** on horizontal overflow
  at any width — the failure mode that actually matters on a phone.
- **`audit.mjs`** runs every screen through axe-core at an iPhone viewport, in
  **both Chromium and WebKit**. WebKit is Safari/iOS, which is a large share of
  cafe customers, so it is the only way to actually verify the "works on
  standard Android/iOS browsers" claim. It is also what caught that two colours in
  the locked palette cannot legally carry body text — see below.
- **`flow.mjs`** places a real order and asserts the staff board sees it and the
  customer's screen tracks the status changes.

### What the tests cover

- **Money maths** — totals from many lines, integer-only arithmetic,
  re-pricing against a live menu, refusal of a tampered total.
- **Status machine** — every legal hop, and that skipping or reversing is
  refused.
- **Reports** — revenue/orders/AOV reconciliation, top-seller ranking, share
  sums, per-day buckets, half-open range boundaries (so months never double
  count), year roll-over, CSV escaping.
- **QR encoder** — round-tripped through a real decoder for every plausible table
  URL, plus finder-pattern and quiet-zone structure checks.
- **Storage contract** — the behaviours both backends must satisfy, asserted
  against the demo store: live emission, ordering, no deletes, bounded ranges.
- **UI** — cart stepper maths, sold-out items, staff status buttons, sheet
  dialog semantics, accessible labelling.

### A note on the palette and contrast

`docs/anime-theme.md` §2 locks the palette, and three of those colours are
mid-tones that cannot legally carry body text on a light background:

| Colour               | On         | Ratio | AA needs |
| -------------------- | ---------- | ----- | -------- |
| terracotta `#C97B3D` | cream text | 2.9:1 | 4.5:1    |
| sage `#6B8E5A`       | pale sage  | 3.0:1 | 4.5:1    |
| berry `#C0505B`      | paper      | 4.4:1 | 4.5:1    |

Rather than change the locked hues, the theme keeps them for their documented
purpose — icons, chart bars, borders, category accents — and adds
`--secondary-deep`, `--sage-deep` and `--berry-deep`: the same hues darkened just
enough to carry text. `scripts/audit.mjs` is the gate that keeps this true, and
it runs in CI.

The `self-check` CI job deliberately breaks the money calculation on `main` and
fails if the suite stays green. A test suite nobody has seen go red is not a
quality gate.

---

## Design

Warm cream café palette, locked in [`docs/anime-theme.md`](./docs/anime-theme.md) §2
and implemented as CSS variables. Three font families, only the weights actually
used, self-hosted via `next/font` so there is no render-blocking Google request.

The mascot is **original** — a hand-authored chibi barista, not any existing
anime character, as the theme doc requires. She appears on the loading state, the
empty states, the order confirmation and the sign-in gate, and the same markup
generates the PWA icon set.

Accessibility and mobile ergonomics are not afterthoughts:

- every touch target is at least 44×44px
- verified at 320 / 390 / 430 / 768 / 1280 px with no horizontal scroll
- `prefers-reduced-motion` disables every animation
- prices and item names stay in a plain sans-serif; the handwritten font is
  decorative only
- the cart sheet is a real modal dialog (Escape, focus, backdrop)
- status changes are announced via `aria-live`

---

## Roadmap

Delivered in this repository: customer ordering, live staff board, menu
management, reporting, QR generation, PWA, security rules, tests, CI.

Not built, and the requirements already scope it out:

- **Payments.** Pay-at-counter for v1. `paymentMethod` is on the order document
  so adding UPI is a UI change, not a migration.
- **Background push.** FCM/Web Push for when the staff phone is locked — needs a
  service worker + VAPID keys, and a real device to be worth testing on.
- **Scheduled monthly reports** by email/PDF. The aggregation is already a pure
  function, so this is a scheduled job calling `buildReport()`.
- **Customer accounts** and order history. The per-table localStorage session
  covers the honest v1 case (one phone, one table, one visit).

---

## Licence

MIT — see [LICENSE](./LICENSE). The mascot, icons and illustrations in this repo
are original work created for this project; no anime or manga IP is used or
referenced.
