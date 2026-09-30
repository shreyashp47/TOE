/**
 * The "Pay by UPI" card. The link has its own tests in src/lib/__tests__; this
 * checks what the customer actually sees — above all, that the screen says the
 * counter is not told about the payment.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { UpiPay } from "@/components/UpiPay";

const payee = { address: "mochibeans@okaxis", name: "Mochi & Beans" };

describe("UpiPay", () => {
  it("links to the UPI app with the amount and table filled in", () => {
    render(
      <UpiPay payee={payee} amount={240} tableNumber={3} orderNumber={417} />,
    );
    const link = screen.getByRole("link", { name: /pay ₹240 with a upi app/i });
    expect(link).toHaveAttribute(
      "href",
      "upi://pay?pa=mochibeans@okaxis&pn=Mochi%20%26%20Beans&am=240.00&cu=INR&tn=Table%203%20-%20Order%20417",
    );
  });

  it("shows a QR code of the same link for another phone", () => {
    render(
      <UpiPay payee={payee} amount={240} tableNumber={3} orderNumber={417} />,
    );
    expect(
      screen.getByRole("img", {
        name: "UPI payment QR code for Mochi & Beans",
      }),
    ).toBeInTheDocument();
  });

  it("tells the customer to show the payment at the counter", () => {
    render(
      <UpiPay payee={payee} amount={240} tableNumber={3} orderNumber={417} />,
    );
    expect(
      screen.getByText("Show the payment screen at the counter."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/don.t get told when a UPI payment/i),
    ).toBeVisible();
    expect(screen.getByText(/optional/i)).toBeInTheDocument();
  });

  it("renders nothing when there is nothing to pay", () => {
    const { container } = render(
      <UpiPay payee={payee} amount={0} tableNumber={3} orderNumber={417} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
