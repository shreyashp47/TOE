/**
 * Dev-only end-to-end walkthrough of the flows that matter:
 * owner creates table codes -> a typed-in address is turned away -> customer
 * places an order from the QR link -> staff board receives it live -> staff
 * advances the status -> the customer's screen reflects it without a refresh ->
 * staff reject a second order and the customer is told.
 *
 * Runs against `next dev` (or BASE_URL) in demo mode, where "live" is
 * localStorage + BroadcastChannel. Also fails on any console error.
 *
 *   npm run flow                 # same as: node scripts/flow.mjs
 *
 * DEMO MODE ONLY. It signs in to the staff board with the demo PIN and places a
 * real order, so never set BASE_URL to the live site (toe-cafe.web.app), and
 * move a .env.local with real Firebase keys aside first: the `next dev` this
 * starts reads it, and the order would land in the real project.
 */
import { mkdir, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import process from "node:process";
import { chromium, devices } from "playwright";

const OUT = ".screenshots/flow";
const PORT = 4311;
const BASE = process.env.BASE_URL ?? `http://127.0.0.1:${PORT}`;

const step = (n, msg) => console.log(`\n[${n}] ${msg}`);
let failures = 0;

function check(label, condition, extra = "") {
  if (condition) {
    console.log(`  ok  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${label} ${extra}`);
  }
}

async function waitForServer(url, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { redirect: "manual" });
      if (res.status < 500) return true;
    } catch {
      /* not up */
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

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

// One context, two pages: this is what makes demo-mode "live" work, and it is
// also exactly how a real customer + staff pair behaves.
const context = await browserContext();
const errors = [];

async function browserContext() {
  return chromium.launch().then(async (browser) => {
    const ctx = await browser.newContext({
      ...devices["iPhone 13"],
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
    });
    return ctx;
  });
}

function watch(page, tag) {
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`[${tag}] ${m.text()}`);
  });
  page.on("pageerror", (e) => errors.push(`[${tag}] pageerror: ${e.message}`));
  return page;
}

const customer = watch(await context.newPage(), "customer");
const staff = watch(await context.newPage(), "staff");

// --- 0. the owner turns on table codes ---------------------------------------
step(0, "Owner creates table codes on /admin/qr");
const owner = watch(await context.newPage(), "owner");
await owner.goto(`${BASE}/staff`, { waitUntil: "networkidle" });
await owner.getByRole("button", { name: "Fill owner" }).click();
await owner.getByRole("button", { name: "Sign in" }).click();
await owner.waitForURL(/\/admin/, { timeout: 20_000 });
await owner.goto(`${BASE}/admin/qr`, { waitUntil: "networkidle" });
await owner
  .getByRole("button", { name: "Create codes for all tables" })
  .click();
await owner.getByText(/Every table has a code/).waitFor({ timeout: 10_000 });
const qrLink = (
  await owner
    .getByText(/\/order\?table=3&k=/)
    .first()
    .innerText()
).trim();
check(
  "table 3's card carries a code",
  /\/order\?table=3&k=[A-Za-z0-9]{12}$/.test(qrLink),
  qrLink,
);
await owner.screenshot({ path: `${OUT}/00-owner-qr-codes.png` });
const keyedPath = qrLink.replace(/^https?:\/\/[^/]+/, "");
// Sign out, so the staff page below starts from its own sign-in.
await owner.getByRole("button", { name: "Sign out" }).click();
await owner.close();

// --- 1. customer browses and adds items -------------------------------------
step("1a", "A typed-in address, without the code, is turned away at checkout");
await customer.goto(`${BASE}/order?table=3`, { waitUntil: "networkidle" });
await customer.waitForSelector("li", { timeout: 30_000 });
await customer
  .locator("li", { hasText: "Cappuccino" })
  .getByRole("button", { name: /^Add$/ })
  .first()
  .click();
await customer.getByRole("button", { name: /View order/ }).click();
await customer.getByRole("checkbox").check();
await customer.getByRole("button", { name: /Place order/ }).click();
await customer
  .getByText("To order, please scan the QR code on your table.")
  .waitFor({ timeout: 10_000 });
check("told to scan the QR code instead", true);
await customer.screenshot({ path: `${OUT}/01a-keyless-refused.png` });
// Empty the basket again so the counts below start from nothing.
await customer.getByRole("button", { name: "Remove", exact: true }).click();

step(1, "Customer opens the table QR link");
await customer.goto(`${BASE}${keyedPath}`, { waitUntil: "networkidle" });
check(
  "table number shown in header",
  await customer.getByText("3", { exact: true }).first().isVisible(),
);

step(2, "Customer adds two different items");
// Target by name, not index: adding the first item turns its "Add" button into a
// stepper, which shifts the index of every button after it.
const addByName = async (page, name) => {
  const button = page
    .locator("li", { hasText: name })
    .getByRole("button", { name: /^Add$/ })
    .first();
  // The cart trigger is a fixed bottom bar, so a card scrolled to the very
  // bottom of the viewport sits underneath it. Centre the target first.
  await button.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await button.waitFor({ state: "visible" });
  await button.click();
};

/** Same, but for the +/- stepper that replaces the Add button. */
const stepper = async (page, ariaLabel) => {
  const button = page
    .getByRole("button", { name: ariaLabel, exact: true })
    .first();
  await button.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await button.waitFor({ state: "visible" });
  await button.click();
};

await customer.waitForSelector("li", { timeout: 30_000 });
await addByName(customer, "Cappuccino");
await addByName(customer, "Butter Scone");
// Once an item is in the cart its Add button becomes a stepper — use it, which
// is also what exercises the "Add one more …" control.
await stepper(customer, "Add one more Butter Scone");
await customer.waitForTimeout(300);
check(
  "cart trigger shows 3 items",
  (
    await customer.getByRole("button", { name: /View order/ }).innerText()
  ).includes("3"),
);
await customer.screenshot({
  path: `${OUT}/01-menu-with-cart.png`,
  fullPage: false,
});

step(3, "Customer opens the cart sheet");
await customer.getByRole("button", { name: /View order/ }).click();
await customer.waitForTimeout(500);
check("sheet is a dialog", await customer.getByRole("dialog").isVisible());
check(
  "place order is disabled before consent",
  await customer.getByRole("button", { name: /Place order/ }).isDisabled(),
);
await customer.screenshot({ path: `${OUT}/02-cart-sheet.png` });

step(4, "Customer consents and places the order");
await customer.getByRole("checkbox").check();
await customer.getByRole("button", { name: /Place order/ }).click();
await customer.waitForURL(/\/order\/confirmation/, { timeout: 20_000 });
check(
  "landed on the confirmation screen",
  /\/order\/confirmation/.test(customer.url()),
);
await customer.waitForTimeout(1200);
check(
  "confirmation shows an order number",
  /Order\s*#\d+/i.test(await customer.locator("main").innerText()),
);
await customer.screenshot({
  path: `${OUT}/03-confirmation.png`,
  fullPage: true,
});
const orderUrl = customer.url();

// --- 2. staff board receives it live -----------------------------------------
step(5, "Staff signs in and sees the order without refreshing");
await staff.goto(`${BASE}/staff`, { waitUntil: "networkidle" });
await staff
  .getByRole("button", { name: "PIN" })
  .click()
  .catch(() => {});
await staff.getByPlaceholder("••••").fill("1122");
await staff.getByRole("button", { name: "Sign in" }).click();
await staff.waitForSelector("text=Order board", { timeout: 20_000 });
check(
  "table 3 ticket is on the board",
  (await staff
    .getByText("Table 3")
    .first()
    .isVisible()
    .catch(() => false)) ||
    (await staff.locator("main").innerText()).includes("3"),
);
check(
  "board lists the ordered item",
  (await staff.locator("main").innerText()).includes("Cappuccino"),
);
await staff.screenshot({ path: `${OUT}/04-staff-board.png`, fullPage: true });

step(6, "Staff marks it ready");
await staff.getByRole("button", { name: "Mark ready" }).click();
await staff.waitForTimeout(900);
check(
  "badge now reads Ready",
  (await staff.locator("main").innerText()).includes("Ready"),
);

// --- 3. customer sees it live ------------------------------------------------
step(7, "Customer screen reflects the change with no refresh");
await customer.waitForFunction(
  () => document.body.innerText.includes("Ready — a barista"),
  undefined,
  { timeout: 20_000 },
);
check("customer timeline advanced to Ready", true);
await customer.screenshot({
  path: `${OUT}/05-customer-ready.png`,
  fullPage: true,
});

step(8, "Staff serves then completes; ticket leaves the board");
await staff.getByRole("button", { name: "Mark served" }).click();
await staff.waitForTimeout(600);
await staff.getByRole("button", { name: "Complete" }).click();
await staff.waitForTimeout(1200);
check(
  "board is empty after completing",
  (await staff.locator("main").innerText()).includes("All caught up"),
);
await staff.screenshot({ path: `${OUT}/06-staff-empty.png`, fullPage: true });

step(9, "Reload keeps the customer on their live order");
await customer.goto(orderUrl, { waitUntil: "networkidle" });
await customer.waitForTimeout(1200);
check(
  "reload still shows the order",
  (await customer.locator("main").innerText()).includes("Order"),
);

// --- 4. cart persistence -----------------------------------------------------
step(10, "Staff reject a second order; the customer is told plainly");
// The phone's own 30-second throttle note, not the thing under test here.
await customer.evaluate(() => localStorage.removeItem("toe.lastOrderAt"));
// Keyless address this time: the phone remembers the code from the scan.
await customer.goto(`${BASE}/order?table=3`, { waitUntil: "networkidle" });
await addByName(customer, "Masala Chai");
await customer.getByRole("button", { name: /View order/ }).click();
await customer.getByRole("checkbox").check();
await customer.getByRole("button", { name: /Place order/ }).click();
await customer.waitForURL(/\/order\/confirmation/, { timeout: 20_000 });
check(
  "a remembered code lets a second order through",
  /\/order\/confirmation/.test(customer.url()),
);
await staff.getByRole("button", { name: /^Reject order #/ }).click();
check(
  "reject asks on the ticket first",
  await staff.getByText(/^Reject order #\d+ from table 3\?$/).isVisible(),
);
await staff.getByRole("button", { name: "No one at this table" }).click();
await staff.screenshot({ path: `${OUT}/07-staff-reject-confirm.png` });
await staff.getByRole("button", { name: "Reject order" }).click();
await staff.waitForTimeout(900);
check(
  "rejected ticket leaves the board",
  (await staff.locator("main").innerText()).includes("All caught up"),
);
await customer.waitForFunction(
  () => document.body.innerText.includes("couldn't accept this order"),
  undefined,
  { timeout: 20_000 },
);
check(
  "customer sees the reason",
  (await customer.locator("main").innerText()).includes("No one at this table"),
);
await customer.screenshot({
  path: `${OUT}/08-customer-rejected.png`,
  fullPage: true,
});

step(11, "Cart survives a reload");
await customer.goto(`${BASE}/order?table=3`, { waitUntil: "networkidle" });
await addByName(customer, "Masala Chai");
await customer.reload({ waitUntil: "networkidle" });
await customer.waitForTimeout(600);
check(
  "cart persisted across reload",
  await customer.getByRole("button", { name: /View order/ }).isVisible(),
);

await context.close();

const unique = [...new Set(errors)];
if (unique.length) {
  console.log(`\n--- ${unique.length} console error(s) ---`);
  for (const e of unique) console.log(e);
  failures += unique.length;
}
if (dev) dev.kill("SIGTERM");

console.log(
  failures === 0
    ? "\nflow: all checks passed"
    : `\nflow: ${failures} failure(s)`,
);
process.exit(failures === 0 ? 0 : 1);
