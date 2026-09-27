import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  ORDER_GAP_SECONDS,
  OrderThrottled,
  forgetLastOrder,
  readLastOrderAt,
  recordOrderPlaced,
  secondsUntilNextOrder,
  throttleMessage,
} from "../order-throttle";

const T0 = 1_790_000_000_000;

describe("secondsUntilNextOrder", () => {
  it("lets a customer who has never ordered go straight ahead", () => {
    expect(secondsUntilNextOrder(null, T0)).toBe(0);
  });

  it("counts down the rest of the gap, rounding up", () => {
    expect(secondsUntilNextOrder(T0, T0)).toBe(ORDER_GAP_SECONDS);
    expect(secondsUntilNextOrder(T0, T0 + 5_000)).toBe(ORDER_GAP_SECONDS - 5);
    // 0.2 s left is still "wait 1 second", never "wait 0 seconds".
    expect(secondsUntilNextOrder(T0, T0 + ORDER_GAP_SECONDS * 1000 - 200)).toBe(
      1,
    );
  });

  it("opens exactly at the gap, which is what the rule allows (>=)", () => {
    expect(secondsUntilNextOrder(T0, T0 + ORDER_GAP_SECONDS * 1000)).toBe(0);
    expect(secondsUntilNextOrder(T0, T0 + 60_000)).toBe(0);
  });

  it("waits the full gap if the clock has gone backwards", () => {
    expect(secondsUntilNextOrder(T0, T0 - 10_000)).toBe(ORDER_GAP_SECONDS);
  });

  it("ignores a corrupt stored time rather than blocking forever", () => {
    expect(secondsUntilNextOrder(Number.NaN, T0)).toBe(0);
  });
});

describe("throttleMessage", () => {
  it("tells the customer what to do, in seconds", () => {
    expect(throttleMessage(25)).toMatch(/another in 25 seconds\.$/);
    expect(throttleMessage(1)).toMatch(/another in 1 second\.$/);
  });

  it("never says zero or a fraction", () => {
    expect(throttleMessage(0)).toMatch(/in 1 second\./);
    expect(throttleMessage(2.1)).toMatch(/in 3 seconds\./);
  });

  it("is what OrderThrottled carries", () => {
    const err = new OrderThrottled(12);
    expect(err).toBeInstanceOf(Error);
    expect(err.seconds).toBe(12);
    expect(err.message).toBe(throttleMessage(12));
  });
});

describe("the phone's note of its last order", () => {
  it("round-trips through storage and can be forgotten", () => {
    expect(readLastOrderAt()).toBeNull();
    recordOrderPlaced(T0);
    expect(readLastOrderAt()).toBe(T0);
    forgetLastOrder();
    expect(readLastOrderAt()).toBeNull();
  });

  it("reads junk as no note at all", () => {
    localStorage.setItem("toe.lastOrderAt", "not a number");
    expect(readLastOrderAt()).toBeNull();
  });
});

describe("the gap agrees with firestore.rules", () => {
  it("uses the same number of seconds the server enforces", () => {
    // The rules are the real limit. If the two drift, a customer is either told
    // to wait when the server would have let them through, or told nothing and
    // shown a bare refusal.
    // vitest runs from the repo root (jsdom makes import.meta.url non-file).
    const rules = readFileSync(
      resolve(process.cwd(), "firestore.rules"),
      "utf8",
    );
    const match = /lastOrderAt \+ duration\.value\((\d+), 's'\)/.exec(rules);
    expect(
      match,
      "throttle clause not found in firestore.rules",
    ).not.toBeNull();
    expect(Number(match?.[1])).toBe(ORDER_GAP_SECONDS);
  });
});
