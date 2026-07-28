import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AccountBalance, isSuspenseAccount, type WireAccount } from "./account-display";

function account(overrides: Partial<WireAccount> = {}): WireAccount {
  return {
    id: "acc-1",
    name: "Operating",
    currency: "USD",
    type: "normal",
    balance: { amount: "0.00", currency: "USD" },
    active: true,
    createdAt: "2026-07-28T00:00:00.000Z",
    ...overrides,
  };
}

/**
 * The rendered balance, read as one string.
 *
 * The amount and its currency code live in separate elements so the figure can
 * carry the emphasis, which means `getByText` — it joins only an element's
 * *direct* text children — can no longer see the pair. Reading `textContent`
 * asserts the same contract more directly: whatever the server sent, followed
 * by its currency, with nothing added and nothing reformatted.
 */
function renderedBalance(): string {
  return screen.getByTestId("account-balance").textContent ?? "";
}

describe("AccountBalance", () => {
  it("renders the wire string exactly, at whatever scale the server sent", () => {
    // The server has already formatted this with Money.format() at the
    // currency's own exponent. Re-deriving it client-side would create a
    // second formatting path that could disagree.
    render(
      <AccountBalance account={account({ balance: { amount: "1234.50", currency: "USD" } })} />,
    );
    expect(renderedBalance()).toBe("1234.50 USD");
  });

  it("does not pad a zero-exponent currency to two decimals", () => {
    render(
      <AccountBalance
        account={account({ currency: "JPY", balance: { amount: "1250", currency: "JPY" } })}
      />,
    );
    expect(renderedBalance()).toBe("1250 JPY");
  });

  it("renders a three-exponent currency at three decimals", () => {
    render(
      <AccountBalance
        account={account({ currency: "BHD", balance: { amount: "0.005", currency: "BHD" } })}
      />,
    );
    expect(renderedBalance()).toBe("0.005 BHD");
  });

  it("keeps the amount and its currency in one contiguous accessible string", () => {
    // The visible gap is drawn with a margin, so without the literal space the
    // pair would reach a screen reader as "1250JPY".
    render(
      <AccountBalance
        account={account({ currency: "JPY", balance: { amount: "1250", currency: "JPY" } })}
      />,
    );
    expect(renderedBalance()).not.toContain("1250JPY");
  });

  it("renders a negative external balance plainly, not as an error", () => {
    // External accounts are *expected* to go negative — that is what makes
    // them the boundary money enters the sandbox through.
    const { container } = render(
      <AccountBalance
        account={account({ type: "external", balance: { amount: "-5000.00", currency: "USD" } })}
      />,
    );
    expect(renderedBalance()).toBe("-5000.00 USD");
    expect(container.querySelector(".text-destructive")).toBeNull();
  });

  it("flags a negative NORMAL balance, which invariant #6 makes impossible", () => {
    const { container } = render(
      <AccountBalance
        account={account({ type: "normal", balance: { amount: "-1.00", currency: "USD" } })}
      />,
    );
    expect(container.querySelector(".text-destructive")).not.toBeNull();
  });
});

describe("isSuspenseAccount", () => {
  it("recognises the accounts sandbox reset opens on its own", () => {
    expect(isSuspenseAccount(account({ type: "external", name: "Sandbox Suspense USD" }))).toBe(
      true,
    );
  });

  it("does not mistake a user-named account for one", () => {
    expect(isSuspenseAccount(account({ type: "external", name: "Sandbox Funding" }))).toBe(false);
    // A `normal` account can never be a suspense account regardless of name.
    expect(isSuspenseAccount(account({ type: "normal", name: "Sandbox Suspense USD" }))).toBe(
      false,
    );
  });
});
