import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { peekOperation } from "@/lib/ledger/idempotency";

const reverseTransaction = vi.fn();
const navigate = vi.fn();

vi.mock("@/utils/orpc", () => ({
  client: {
    transactions: { reverse: (...args: unknown[]) => reverseTransaction(...args) },
  },
  orpc: {
    accounts: { list: { key: () => ["accounts", "list"] } },
    transactions: { list: { key: () => ["transactions", "list"] } },
  },
}));

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@tanstack/react-router");
  return { ...actual, useNavigate: () => navigate };
});

const { CONFIRMATION_WORD, ReverseDialog } = await import("./reverse-dialog");

const TXN = "11111111-2222-3333-4444-555555555555";

function renderDialog(
  transactionId = TXN,
  reversedBy: readonly string[] = [],
  partOfExchange = false,
) {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ReverseDialog
        transactionId={transactionId}
        reversedBy={reversedBy}
        partOfExchange={partOfExchange}
      />
    </QueryClientProvider>,
  );
}

function keyStore() {
  return {
    read: (slot: string) => globalThis.sessionStorage.getItem(slot),
    write: (slot: string, value: string) => globalThis.sessionStorage.setItem(slot, value),
    clear: (slot: string) => globalThis.sessionStorage.removeItem(slot),
  };
}

async function openAndConfirm() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Reverse" }));
  await user.type(screen.getByLabelText(`Type ${CONFIRMATION_WORD} to confirm`), CONFIRMATION_WORD);
  await user.click(screen.getByRole("button", { name: "Post reversal" }));
}

beforeEach(() => {
  reverseTransaction.mockReset();
  navigate.mockReset();
  globalThis.sessionStorage.clear();
});

describe("the reversal payload", () => {
  it("carries only the transaction id and an idempotency key — never legs", async () => {
    // The server rebuilds the mirrored postings from the persisted rows
    // precisely so there is nothing here for a caller to tamper with. Sending
    // legs would be meaningless at best.
    reverseTransaction.mockResolvedValue({ id: "rev-1" });
    renderDialog();
    await openAndConfirm();

    await waitFor(() => expect(reverseTransaction).toHaveBeenCalledTimes(1));
    const payload = reverseTransaction.mock.calls[0]?.[0] as Record<string, unknown>;

    expect(Object.keys(payload).sort()).toEqual(["idempotencyKey", "transactionId"]);
    expect(payload).not.toHaveProperty("postings");
    expect(payload.transactionId).toBe(TXN);
    expect(typeof payload.idempotencyKey).toBe("string");
  });
});

describe("confirmation friction", () => {
  it("cannot be posted without typing the confirmation word", async () => {
    renderDialog();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Reverse" }));

    expect(screen.getByRole("button", { name: "Post reversal" })).toBeDisabled();

    await user.type(screen.getByLabelText(`Type ${CONFIRMATION_WORD} to confirm`), "reverse");
    // Case-sensitive on purpose: it should be impossible to do by reflex.
    expect(screen.getByRole("button", { name: "Post reversal" })).toBeDisabled();

    await user.clear(screen.getByLabelText(`Type ${CONFIRMATION_WORD} to confirm`));
    await user.type(
      screen.getByLabelText(`Type ${CONFIRMATION_WORD} to confirm`),
      CONFIRMATION_WORD,
    );
    expect(screen.getByRole("button", { name: "Post reversal" })).toBeEnabled();
  });

  it("fires no mutation when dismissed", async () => {
    renderDialog();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Reverse" }));
    await user.type(
      screen.getByLabelText(`Type ${CONFIRMATION_WORD} to confirm`),
      CONFIRMATION_WORD,
    );
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(reverseTransaction).not.toHaveBeenCalled();
  });

  it("states that a transaction can be reversed only once", async () => {
    // This assertion is the inverse of the one it replaces, and the inversion
    // is the point. It used to require the words "not deduplicated", which was
    // true through 6b. Migration `0007` (open question #3) made the partial
    // unique index on `reverses_transaction_id` unique, so a second reversal is
    // now refused with `409 already_reversed` — and the old copy became a false
    // statement about a money operation, on that operation's own confirmation
    // screen. Rewritten rather than deleted, so the rule stays pinned.
    renderDialog();
    await userEvent.click(screen.getByRole("button", { name: "Reverse" }));

    expect(screen.getByText(/only once/i)).toBeInTheDocument();
    expect(screen.queryByText(/not deduplicated/i)).not.toBeInTheDocument();
  });
});

describe("idempotency", () => {
  it("scopes the key to the transaction being reversed", async () => {
    reverseTransaction.mockResolvedValue({ id: "rev-1" });
    renderDialog("aaaa1111-2222-3333-4444-555555555555");
    await openAndConfirm();

    await waitFor(() => expect(reverseTransaction).toHaveBeenCalled());
    // Reversing A and reversing B must never share a slot, or the second
    // would collide with the first as a false 409.
    expect(peekOperation("reverse:aaaa1111-2222-3333-4444-555555555555", keyStore())).toBeNull();
    expect(globalThis.sessionStorage.getItem("ledger.idempotency.reverse:other")).toBeNull();
  });

  it("releases the slot after a successful reversal", async () => {
    reverseTransaction.mockResolvedValue({ id: "rev-1" });
    renderDialog();
    await openAndConfirm();

    await waitFor(() => expect(navigate).toHaveBeenCalled());
    expect(peekOperation(`reverse:${TXN}`, keyStore())).toBeNull();
  });

  it("attempts exactly once and does not auto-retry a failure", async () => {
    reverseTransaction.mockRejectedValue({
      code: "UNPROCESSABLE_CONTENT",
      status: 422,
      message: "server string",
      data: { reason: "insufficient_funds" },
    });

    renderDialog();
    await openAndConfirm();

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    // A reversal moves money; retrying it automatically is never correct.
    expect(reverseTransaction).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/server string/)).not.toBeInTheDocument();
  });
});

describe("already-reversed warning (Phase 6b, open question #3)", () => {
  async function open() {
    await userEvent.setup().click(screen.getByRole("button", { name: "Reverse" }));
  }

  it("says nothing has reversed this transaction when reversedBy is empty", async () => {
    renderDialog(TXN, []);
    await open();

    expect(screen.queryByTestId("already-reversed")).not.toBeInTheDocument();
    expect(
      screen.getByText(/second reversal of this same transaction will be refused/),
    ).toBeInTheDocument();
  });

  it("states plainly that the transaction was already reversed", async () => {
    // Before 6b this dialog could only disclose its own blindness — "this
    // console cannot tell whether this transaction has already been reversed".
    renderDialog(TXN, ["reversal-1"]);
    await open();

    expect(screen.getByTestId("already-reversed")).toHaveTextContent(
      "This transaction has already been reversed.",
    );
    expect(screen.queryByText(/cannot tell whether/)).not.toBeInTheDocument();
  });

  it("does not invent a count, even given a list longer than the constraint allows", async () => {
    // This used to assert "already been reversed 2 times", which the wire type
    // still permits — `reversedBy` stays an array, because narrowing it to a
    // scalar would break the published contract (open question #3).
    //
    // But since migration `0007` the database refuses a second reversal of the
    // same transaction, so a length above 1 is unreachable rather than merely
    // rare. Rendering a count for an unreachable state is dead output that
    // reads as if the ledger allows something it does not, so the copy states
    // the rule instead — and this test pins that even an anomalous list does
    // not resurrect the tally.
    renderDialog(TXN, ["reversal-1", "reversal-2"]);
    await open();

    expect(screen.getByTestId("already-reversed")).toHaveTextContent(
      "This transaction has already been reversed.",
    );
    expect(screen.queryByText(/2 times/)).not.toBeInTheDocument();
  });

  it("warns but does not block — the server is the arbiter", async () => {
    // The console tells the user a second reversal will be refused; it does not
    // refuse on the server's behalf. Same rule as every other affordance here
    // (open question #1): the UI decides what to *offer*, never what the API
    // permits, and the `409 already_reversed` is what actually stops it.
    reverseTransaction.mockResolvedValue({ id: "new-reversal" });
    renderDialog(TXN, ["reversal-1"]);
    await openAndConfirm();

    await waitFor(() => expect(reverseTransaction).toHaveBeenCalledTimes(1));
  });
});

describe("exchange warning (open question #20)", () => {
  async function open() {
    await userEvent.setup().click(screen.getByRole("button", { name: "Reverse" }));
  }

  it("says both halves will be reversed when the transaction is part of an exchange", async () => {
    renderDialog(TXN, [], true);
    await open();

    expect(screen.getByTestId("exchange-pair-warning")).toHaveTextContent(
      "This reverses both halves of an exchange.",
    );
  });

  it("says nothing about halves for an ordinary transaction", async () => {
    // The claim is only true of an FX leg. Showing it unconditionally would
    // describe a second transaction that does not exist.
    renderDialog(TXN, [], false);
    await open();

    expect(screen.queryByTestId("exchange-pair-warning")).not.toBeInTheDocument();
  });
});
