import { describe, expect, it } from "vitest";

import {
  ACTIVE_STATUSES,
  CUSTOMER_STEPS,
  ORDER_STATUSES,
  actionsFor,
  canAdvance,
  isActiveStatus,
  isOrderStatus,
  nextStatus,
  stepIndex,
  transition,
} from "@/lib/order-status";

describe("order status machine", () => {
  it("declares the documented chain", () => {
    expect(ORDER_STATUSES).toEqual([
      "received",
      "preparing",
      "ready",
      "served",
      "completed",
    ]);
  });

  it("walks forward one step at a time", () => {
    expect(nextStatus("received")).toBe("preparing");
    expect(nextStatus("preparing")).toBe("ready");
    expect(nextStatus("ready")).toBe("served");
    expect(nextStatus("served")).toBe("completed");
  });

  it("treats completed as terminal", () => {
    expect(nextStatus("completed")).toBeNull();
    expect(actionsFor("completed")).toEqual([]);
  });

  it("refuses to skip a step", () => {
    expect(canAdvance("preparing", "served")).toBe(false);
    expect(canAdvance("received", "ready")).toBe(false);
    expect(transition("preparing", "served")).toBeNull();
  });

  it("refuses to go backwards", () => {
    expect(canAdvance("ready", "preparing")).toBe(false);
    expect(transition("completed", "preparing")).toBeNull();
  });

  it("refuses to re-apply the same status", () => {
    expect(canAdvance("preparing", "preparing")).toBe(false);
  });

  it("accepts the legal transition", () => {
    expect(transition("preparing", "ready")).toBe("ready");
  });

  // This used to assert the opposite: Ready offered a "Complete" button, but
  // ready -> completed is not a legal hop here or in firestore.rules, so the
  // board's guard refused it and the tap silently did nothing.
  it("does not offer Complete from ready — serve it first", () => {
    expect(actionsFor("ready").map((a) => a.to)).toEqual(["served"]);
  });

  it("only ever offers a button the machine will accept", () => {
    for (const status of ORDER_STATUSES) {
      for (const action of actionsFor(status)) {
        expect(
          transition(status, action.to),
          `${status} offers "${action.label}" -> ${action.to}`,
        ).toBe(action.to);
      }
    }
  });

  it("always offers exactly one primary action, except when closed", () => {
    for (const status of ORDER_STATUSES) {
      const primaries = actionsFor(status).filter((a) => a.primary);
      if (status === "completed") expect(primaries).toHaveLength(0);
      else expect(primaries).toHaveLength(1);
    }
  });

  it("only lists active statuses on the staff board", () => {
    for (const status of ACTIVE_STATUSES) {
      expect(status).not.toBe("completed");
    }
    expect(isActiveStatus("completed")).toBe(false);
    expect(isActiveStatus("preparing")).toBe(true);
  });

  it("validates unknown statuses", () => {
    expect(isOrderStatus("preparing")).toBe(true);
    expect(isOrderStatus("cancelled")).toBe(false);
    expect(isOrderStatus(null)).toBe(false);
    expect(isOrderStatus(3)).toBe(false);
  });

  it("maps a status onto the customer-visible timeline", () => {
    expect(stepIndex("received")).toBe(0);
    expect(stepIndex("preparing")).toBe(1);
    expect(stepIndex("ready")).toBe(2);
    expect(stepIndex("served")).toBe(3);
    // completed means every customer step happened
    expect(stepIndex("completed")).toBe(CUSTOMER_STEPS.length - 1);
  });
});
