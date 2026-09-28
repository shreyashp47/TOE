/**
 * The owner's "Orders | Owner" switch: the one labelled way between the order
 * board and the owner dashboard. Staff must never see it.
 */

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import StaffPage from "@/app/staff/page";
import { OwnerSwitch } from "@/components/OwnerSwitch";
import { demoAuthRepo } from "@/lib/data/demo";
import { resetDemoStore } from "@/lib/data/demo-store";
import { DEMO_CREDENTIALS } from "@/lib/data/seed";

beforeEach(async () => {
  resetDemoStore();
  await demoAuthRepo.signOut();
});

describe("OwnerSwitch", () => {
  it("gives the owner both screens, labelled, with the right links", () => {
    render(<OwnerSwitch role="owner" current="orders" />);

    const nav = screen.getByRole("navigation", { name: "Switch screen" });
    expect(nav).toBeInTheDocument();

    const orders = screen.getByRole("link", { name: "Orders" });
    const owner = screen.getByRole("link", { name: "Owner" });
    expect(orders).toHaveAttribute("href", "/staff");
    expect(owner).toHaveAttribute("href", "/admin");
  });

  it("marks the order board as current on /staff", () => {
    render(<OwnerSwitch role="owner" current="orders" />);
    expect(screen.getByRole("link", { name: "Orders" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Owner" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("marks the owner dashboard as current on /admin", () => {
    render(<OwnerSwitch role="owner" current="owner" />);
    expect(screen.getByRole("link", { name: "Owner" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Orders" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it.each(["staff", "unassigned", undefined] as const)(
    "renders nothing for role %s",
    (role) => {
      const { container } = render(
        <OwnerSwitch role={role} current="orders" />,
      );
      expect(container).toBeEmptyDOMElement();
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
    },
  );
});

describe("order board header (demo backend)", () => {
  it("shows the owner the switch, with Orders current", async () => {
    const { email, password } = DEMO_CREDENTIALS.owner;
    await demoAuthRepo.signIn(email, password);
    render(<StaffPage />);

    const orders = await screen.findByRole("link", { name: "Orders" });
    expect(orders).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Owner" })).toHaveAttribute(
      "href",
      "/admin",
    );
  });

  it("shows a barista the same board with no switch", async () => {
    const { email, password } = DEMO_CREDENTIALS.staff;
    await demoAuthRepo.signIn(email, password);
    render(<StaffPage />);

    await screen.findByRole("heading", { name: "Order board" });
    expect(
      screen.queryByRole("navigation", { name: "Switch screen" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Owner" }),
    ).not.toBeInTheDocument();
  });
});
