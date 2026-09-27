/**
 * Dev-only end-to-end walkthrough of the two flows that matter:
 * customer places an order -> staff board receives it live -> staff advances the
 * status -> the customer's screen reflects it without a refresh.
 *
 * Runs against `next dev` (or BASE_URL) in demo mode, where "live" is
 * localStorage + BroadcastChannel. Also fails on any console error.
 *
 *   node scripts/flow.mjs
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

const dev = process.env.BASE_URL ? null : spawn(
  "npm",
  ["run", "dev", "--", "--port", String(PORT)],
  { stdio: ["ignore", "ignore", "inherit"] },
);
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

// --- 1. customer browses and adds items -------------------------------------
step(1, "Customer opens the table QR link");
await customer.goto(`${BASE}/order?table=3`, { waitUntil: "networkidle" });
check("table number shown in header", await customer.getByText("3", { exact: true }).first().isVisible());

step(2, "Customer adds two different items");
// Target by name, not index: adding the first item turns its "Add" button into a
// stepper, which shifts the index of every button after it.
const addByName = (page, name) =>
  page
    .locator("li", { hasText: name })
    .getByRole("button", { name: /^Add$/ })
    .first();

await addByName(customer, "Cappuccino").click();
await addByName(customer, "Butter Scone").click();
await addByName(customer, "Butter Scone").click(); // 2x
await customer.waitForTimeout(300);
check(
  "cart trigger shows 3 items",
  (await customer.getByRole("button", { name: /View order/ }).innerText()).includes("3"),
);
await customer.screenshot({ path: `${OUT}/01-menu-with-cart.png`, fullPage: false });

step(3, "Customer opens the cart sheet");
await customer.getByRole("button", { name: /View order/ }).click();
await customer.waitForTimeout(500);
check("sheet is a dialog", await customer.getByRole("dialog").isVisible());
check("place order is disabled before consent", await customer.getByRole("button", { name: /Place order/ }).isDisabled());
await customer.screenshot({ path: `${OUT}/02-cart-sheet.png` });

step(4, "Customer consents and places the order");
await customer.getByRole("checkbox").check();
await customer.getByRole("button", { name: /Place order/ }).click();
await customer.waitForURL(/\/order\/confirmation/, { timeout: 20_000 });
check("landed on the confirmation screen", /\/order\/confirmation/.test(customer.url()));
await customer.waitForTimeout(1200);
check("confirmation shows an order number", /Order\s*#\d+/i.test(await customer.locator("main").innerText()));
await customer.screenshot({ path: `${OUT}/03-confirmation.png`, fullPage: true });
const orderUrl = customer.url();

// --- 2. staff board receives it live -----------------------------------------
step(5, "Staff signs in and sees the order without refreshing");
await staff.goto(`${BASE}/staff`, { waitUntil: "networkidle" });
await staff.getByRole("button", { name: "PIN" }).click().catch(() => {});
await staff.getByPlaceholder("••••").fill("1122");
await staff.getByRole("button", { name: "Sign in" }).click();
await staff.waitForSelector("text=Order board", { timeout: 20_000 });
check("table 3 ticket is on the board", await staff.getByText("Table 3").first().isVisible().catch(() => false) || (await staff.locator("main").innerText()).includes("3"));
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
await customer.screenshot({ path: `${OUT}/05-customer-ready.png`, fullPage: true });

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
step(10, "Cart survives a reload");
await customer.goto(`${BASE}/order?table=3`, { waitUntil: "networkidle" });
await addByName(customer, "Masala Chai").click();
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

console.log(failures === 0 ? "\nflow: all checks passed" : `\nflow: ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
