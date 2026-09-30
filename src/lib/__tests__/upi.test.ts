/**
 * UPI pay-at-table. A wrong link here does not fail loudly: it opens the
 * customer's UPI app with the wrong amount, or with a payee that does not
 * exist, and the customer finds out at the counter. So the link is pinned
 * exactly, every value is checked for encoding, and the QR is round-tripped
 * through a real decoder the same way the table cards are.
 */
import jsQR from "jsqr";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getUpiPayee } from "@/lib/config";
import { encodeQr } from "@/lib/qr";
import {
  buildUpiUri,
  formatUpiAmount,
  isValidUpiId,
  readUpiPayee,
  upiNote,
} from "@/lib/upi";

const payee = { address: "mochibeans@okaxis", name: "Mochi & Beans" };

describe("isValidUpiId", () => {
  it.each([
    "mochibeans@okaxis",
    "9876543210@ybl",
    "cafe.owner@paytm",
    "toi_cafe-1@upi",
    "Mochi.Beans@OkIcici",
    "  padded@okhdfcbank  ",
  ])("accepts %s", (id) => {
    expect(isValidUpiId(id)).toBe(true);
  });

  it.each([
    "",
    "mochibeans",
    "@okaxis",
    "mochibeans@",
    "m@okaxis", // a one-character handle is not a real UPI ID
    "mochi beans@okaxis",
    "mochibeans@ok axis",
    "mochi@beans@okaxis",
    "mochibeans@9bank",
    "mochi&beans@okaxis",
    "mochibeans@okaxis?am=1",
    "https://pay.example/mochibeans",
  ])("rejects %j", (id) => {
    expect(isValidUpiId(id)).toBe(false);
  });
});

describe("formatUpiAmount", () => {
  it("always writes two decimals", () => {
    expect(formatUpiAmount(240)).toBe("240.00");
    expect(formatUpiAmount(1)).toBe("1.00");
    expect(formatUpiAmount(1234.5)).toBe("1234.50");
  });

  it.each([0, -10, Number.NaN, Number.POSITIVE_INFINITY])(
    "refuses %s",
    (amount) => {
      expect(() => formatUpiAmount(amount)).toThrow(/positive/);
    },
  );
});

describe("upiNote", () => {
  it("names the table and order in characters every app accepts", () => {
    const note = upiNote(3, 417);
    expect(note).toBe("Table 3 - Order 417");
    expect(note).toMatch(/^[A-Za-z0-9 -]+$/);
  });
});

describe("buildUpiUri", () => {
  it("builds the exact link", () => {
    expect(buildUpiUri({ payee, amount: 240, note: upiNote(3, 417) })).toBe(
      "upi://pay?pa=mochibeans@okaxis&pn=Mochi%20%26%20Beans&am=240.00&cu=INR&tn=Table%203%20-%20Order%20417",
    );
  });

  it("parses back to the values it was given", () => {
    const uri = buildUpiUri({
      payee,
      amount: 1250,
      note: "Table 10 - Order 999",
    });
    const url = new URL(uri);
    expect(url.protocol).toBe("upi:");
    expect(url.searchParams.get("pa")).toBe("mochibeans@okaxis");
    expect(url.searchParams.get("pn")).toBe("Mochi & Beans");
    expect(url.searchParams.get("am")).toBe("1250.00");
    expect(url.searchParams.get("cu")).toBe("INR");
    expect(url.searchParams.get("tn")).toBe("Table 10 - Order 999");
  });

  it("encodes anything that could break out of a parameter", () => {
    const uri = buildUpiUri({
      payee: { address: payee.address, name: "Chai=Tea&am=1#x ☕" },
      amount: 50,
      note: "a+b",
    });
    // exactly five parameters, whatever the name contains
    expect(uri.split("?")[1].split("&")).toHaveLength(5);
    expect(uri).not.toMatch(/[ #☕+]/);
    const url = new URL(uri);
    expect(url.searchParams.get("pn")).toBe("Chai=Tea&am=1#x ☕");
    expect(url.searchParams.get("am")).toBe("50.00");
    expect(url.searchParams.get("tn")).toBe("a+b");
  });

  it("uses %20 for spaces, never +", () => {
    const uri = buildUpiUri({ payee, amount: 10, note: "Table 1" });
    expect(uri).toContain("tn=Table%201");
    expect(uri).not.toContain("+");
  });

  it("trims the address and refuses an invalid one", () => {
    expect(
      buildUpiUri({
        payee: { ...payee, address: " mochibeans@okaxis " },
        amount: 10,
        note: "x",
      }),
    ).toContain("pa=mochibeans@okaxis&");
    expect(() =>
      buildUpiUri({
        payee: { ...payee, address: "not-an-id" },
        amount: 10,
        note: "x",
      }),
    ).toThrow(/not a valid UPI ID/);
  });

  it("refuses a zero amount rather than asking the customer to type one", () => {
    expect(() => buildUpiUri({ payee, amount: 0, note: "x" })).toThrow();
  });

  it("fits in a QR code and scans back to the same link", () => {
    const uri = buildUpiUri({
      payee: {
        address: "a-rather-long-cafe-handle.1234@okhdfcbank",
        name: "The Very Long Named Cafe and Bakery",
      },
      amount: 12345,
      note: upiNote(10, 999),
    });
    const matrix = encodeQr(uri);
    const scale = 6;
    const quiet = 4;
    const width = (matrix.length + quiet * 2) * scale;
    const data = new Uint8ClampedArray(width * width * 4).fill(255);
    matrix.forEach((row, r) =>
      row.forEach((dark, c) => {
        if (!dark) return;
        for (let dy = 0; dy < scale; dy += 1) {
          for (let dx = 0; dx < scale; dx += 1) {
            const i =
              (((r + quiet) * scale + dy) * width + (c + quiet) * scale + dx) *
              4;
            data[i] = data[i + 1] = data[i + 2] = 0;
          }
        }
      }),
    );
    expect(jsQR(data, width, width)?.data).toBe(uri);
  });
});

describe("readUpiPayee", () => {
  it("is off when the ID is unset or blank", () => {
    expect(readUpiPayee(undefined, "Cafe", "Fallback")).toBeNull();
    expect(readUpiPayee("", "Cafe", "Fallback")).toBeNull();
    expect(readUpiPayee("   ", "Cafe", "Fallback")).toBeNull();
  });

  it("treats an invalid ID as off, not as a broken button", () => {
    expect(readUpiPayee("mochibeans", "Cafe", "Fallback")).toBeNull();
  });

  it("falls back to the cafe name for the payee", () => {
    expect(readUpiPayee(" mochibeans@okaxis ", "", "Mochi & Beans")).toEqual({
      address: "mochibeans@okaxis",
      name: "Mochi & Beans",
    });
    expect(readUpiPayee("mochibeans@okaxis", " Asha K ", "x")).toEqual({
      address: "mochibeans@okaxis",
      name: "Asha K",
    });
  });
});

describe("getUpiPayee", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is off with no env set — the shipped default", () => {
    vi.stubEnv("NEXT_PUBLIC_UPI_ID", "");
    expect(getUpiPayee()).toBeNull();
  });

  it("reads both env values", () => {
    vi.stubEnv("NEXT_PUBLIC_UPI_ID", "mochibeans@okaxis");
    vi.stubEnv("NEXT_PUBLIC_UPI_PAYEE_NAME", "Mochi and Beans Cafe");
    expect(getUpiPayee()).toEqual({
      address: "mochibeans@okaxis",
      name: "Mochi and Beans Cafe",
    });
  });
});
