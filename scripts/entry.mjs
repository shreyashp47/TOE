/**
 * How a customer actually gets to the menu — every way in.
 *
 * `scripts/flow.mjs` walks the order/staff/status flow, but it always navigates
 * straight to `/order?table=3`. That skips the path a real customer takes when
 * they have a table number but no QR code in front of them: land on the site,
 * see the table picker, tap their number. Nothing tested that, which is how a
 * dead tap survived: the link navigated correctly and the page then rendered the
 * picker again, so from the customer's side "nothing happened".
 *
 * This script drives each entry separately and prints what actually rendered, so
 * a difference between two ways in is obvious rather than inferred.
 *
 *   node scripts/entry.mjs                  # spawns `next dev`
 *   BASE_URL=https://toi-cafe.web.app node scripts/entry.mjs
 */
import { spawn } from "node:child_process";
import process from "node:process";
import { chromium, devices } from "playwright";

const PORT = 4313;
const BASE = process.env.BASE_URL ?? `http://127.0.0.1:${PORT}`;

let failures = 0;
const step = (n, msg) => console.log(`\n[${n}] ${msg}`);
function check(label, ok, extra = "") {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${extra ? `  ${extra}` : ""}`);
}

async function waitForServer(url, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { redirect: "manual" });
      if (res.status < 500) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

const dev = process.env.BASE_URL
  ? null
  : spawn("npm", ["run", "dev", "--", "--port", String(PORT)], {
      stdio: ["ignore", "ignore", "inherit"],
    });
if (dev && !(await waitForServer(BASE))) {
  dev.kill("SIGKILL");
  console.error("dev server never came up");
  process.exit(1);
}

/** What the customer is actually looking at, in one word. */
async function classify(page) {
  const text = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  if (/which table are you at/i.test(text)) return "table picker";
  // The same component with a different heading, for a number that parses but is
  // not a table this cafe has. A clean landing either way.
  if (/that table number looks odd/i.test(text)) return "odd-table notice";
  if (/mascot|loading/i.test(text) && text.length < 80) return "still loading";
  if (text.includes("₹")) return "menu";
  return `unknown: ${text.slice(0, 60)}`;
}

const browser = await chromium.launch();
const context = await browser.newContext({
  ...devices["iPhone 13"],
  viewport: { width: 390, height: 844 },
});

console.log(`\nentry paths against ${BASE}`);

// -- 1. The site's front door -----------------------------------------------------
step(1, "Land on / — should land on the order page");
{
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  check(
    "/ redirects to the order page",
    page.url().includes("/order"),
    page.url(),
  );
  check("shows the table picker", (await classify(page)) === "table picker");
  check("no console errors", errors.length === 0, errors.join("; "));
  await page.close();
}

// -- 2. Tapping a table number ----------------------------------------------------
// This is the one that was broken. The link is fine and the URL changes; the page
// then re-renders the picker, so the tap looks inert.
step(2, "Tap table 3 on the picker — should show the menu");
{
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);

  const tile = page.locator('a[href*="table="]').first();
  check("the picker offers tappable tables", (await tile.count()) > 0);

  const before = page.url();
  await tile.click();
  await page.waitForTimeout(1500);

  const after = page.url();
  const shown = await classify(page);
  console.log(`  url ${before} -> ${after}`);
  console.log(`  screen shows: ${shown}`);
  check("tapping a table changes the URL", after !== before);
  check("tapping a table shows the menu", shown === "menu", `got "${shown}"`);
  check("no console errors", errors.length === 0, errors.join("; "));
  await page.close();
}

// -- 3. The QR code path ----------------------------------------------------------
// The same destination, reached the way a scanned code reaches it: a full page
// load. Kept as a separate case because it is the one that always worked, and the
// contrast between 2 and 3 is what identifies the fault.
step(3, "Open /order?table=3 directly — the QR path");
{
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(`${BASE}/order?table=3`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  const shown = await classify(page);
  console.log(`  screen shows: ${shown}`);
  check("direct load shows the menu", shown === "menu", `got "${shown}"`);
  check("no console errors", errors.length === 0, errors.join("; "));
  await page.close();
}

// -- 4. Bad and missing table numbers --------------------------------------------
step(4, "Odd table numbers should land on the picker, not break");
// Anything with a table-ish value that is not a real table gets the "looks odd"
// screen, which keeps the picker one tap away. A missing value gets the plain
// picker, because there is nothing to be surprised about.
for (const [query, why, want] of [
  ["?table=99", "a table this cafe does not have", "odd-table notice"],
  ["?table=abc", "not a number", "odd-table notice"],
  ["?table=0", "zero", "odd-table notice"],
  ["?table=-2", "negative", "odd-table notice"],
  ["", "no table at all", "table picker"],
]) {
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${BASE}/order${query}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const shown = await classify(page);
  check(
    `${why} (${query || "no query"}) falls back cleanly`,
    shown === want,
    `got "${shown}", wanted "${want}"`,
  );
  check(`  ...and does not throw`, errors.length === 0, errors.join("; "));
  await page.close();
}

await browser.close();
if (dev) dev.kill("SIGKILL");

console.log(
  failures === 0
    ? "\nentry: all checks passed"
    : `\nentry: ${failures} check(s) failed`,
);
process.exit(failures ? 1 : 0);
