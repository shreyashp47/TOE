/**
 * /order checks the scanned table against the owner's saved list, not the
 * build-time default. Runs the real page on the demo store (the tests have no
 * Firebase config), with the list saved the way /admin/qr saves it.
 */

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import OrderPage from "@/app/order/page";
import { getCafeName } from "@/lib/config";
import { demoConfigRepo } from "@/lib/data/demo";
import { resetDemoStore } from "@/lib/data/demo-store";

// No router in a unit test: stand in the query string it would read, as the
// useTableQuery tests do.
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

function openAt(search: string) {
  window.history.replaceState({}, "", `/order${search}`);
  render(<OrderPage />);
}

beforeEach(() => {
  resetDemoStore();
  window.history.replaceState({}, "", "/order");
});

describe("/order table check", () => {
  it("accepts a table that is only in the saved list", async () => {
    // 9 is outside the 1..6 default, so this passes only if the saved list is
    // what the page checks against.
    await demoConfigRepo.saveTables([1, 2, 3, 9]);
    openAt("?table=9");
    // The menu's header carries the cafe name; the picker does not.
    expect(
      await screen.findByRole("heading", { name: getCafeName() }),
    ).toBeInTheDocument();
    expect(screen.queryByText("That table number looks odd")).toBeNull();
  });

  it("turns away a default table the owner has removed", async () => {
    await demoConfigRepo.saveTables([1, 2, 3, 9]);
    openAt("?table=5");
    expect(
      await screen.findByText("That table number looks odd"),
    ).toBeInTheDocument();
    const offered = screen.getAllByRole("link").map((link) => link.textContent);
    expect(offered).toEqual(["1", "2", "3", "9"]);
  });

  it("uses the default list until the owner saves one", async () => {
    openAt("");
    expect(
      await screen.findByText("Which table are you at?"),
    ).toBeInTheDocument();
    const offered = screen.getAllByRole("link").map((link) => link.textContent);
    expect(offered).toEqual(["1", "2", "3", "4", "5", "6"]);
  });
});
