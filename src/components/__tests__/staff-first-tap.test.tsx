/**
 * The staff board's first tap. Browsers only allow the order chime after a
 * gesture, so the first pointerdown anywhere arms it. That used to remove the
 * "Tap anywhere to switch the order sound on" line from the header, which
 * moved the whole board up between pointerdown and pointerup: the release
 * landed on a different element, no click fired, and the first Accept or
 * Mark ready after opening the board did nothing.
 */

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import StaffPage from "@/app/staff/page";
import { demoAuthRepo, demoOrderRepo } from "@/lib/data/demo";
import { loadDemoState, resetDemoStore } from "@/lib/data/demo-store";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

// jsdom has no WebAudio; without one unlock() bails out before arming.
class FakeAudioContext {
  state = "suspended";
  resume = vi.fn(async () => {
    this.state = "running";
  });
}

beforeEach(async () => {
  resetDemoStore();
  localStorage.clear();
  await demoAuthRepo.signOut();
  vi.stubGlobal("AudioContext", FakeAudioContext);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("staff board: the first tap", () => {
  it("arms the sound without moving the board, and still presses Accept", async () => {
    await demoOrderRepo.create({
      tableNumber: 2,
      items: [{ menuItemId: "m1", name: "Latte", qty: 2, price: 200 }],
      total: 400,
    });
    await demoAuthRepo.signInWithPin("1122");
    render(<StaffPage />);

    const accept = await screen.findByRole("button", { name: "Accept" });
    const hint = screen.getByText("Tap anywhere to switch the order sound on.");

    // Press, and let React re-render before the release — as a real finger does.
    act(() => {
      fireEvent.pointerDown(accept);
    });

    // The line keeps its place (the same element, still on the page) with
    // new words, so nothing below it moves under the finger.
    expect(hint).toBeInTheDocument();
    expect(hint).toHaveTextContent("Order sound on.");
    expect(accept).toBeInTheDocument();

    fireEvent.pointerUp(accept);
    fireEvent.click(accept);
    await waitFor(() =>
      expect(loadDemoState().orders[0].status).toBe("preparing"),
    );
  });
});
