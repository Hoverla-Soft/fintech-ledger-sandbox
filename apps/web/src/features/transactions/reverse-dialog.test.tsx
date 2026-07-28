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

function renderDialog(transactionId = TXN, reversedBy: readonly string[] = []) {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ReverseDialog transactionId={transactionId} reversedBy={reversedBy} />
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

  it("still states that reversals are not deduplicated", async () => {
    // This assertion predates 6b, when the dialog could only disclose its own
    // blindness ("this console cannot tell whether this transaction has
    // already been reversed"). `reversedBy` removed the blindness but changed
    // nothing about the API: reversing is still permitted and still not
    // deduplicated, so that warning must survive. The "cannot tell" framing is
    // covered by its own describe block below, which asserts it is gone.
    renderDialog();
    await userEvent.click(screen.getByRole("button", { name: "Reverse" }));

    expect(screen.getByText(/not deduplicated/i)).toBeInTheDocument();
    expect(screen.getByText(/apply the correction each time/i)).toBeInTheDocument();
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
    expect(screen.getByText(/Nothing has reversed this transaction yet/)).toBeInTheDocument();
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

  it("counts the reversals when there is more than one", async () => {
    // The rendering that a boolean `reversed` flag could not have produced.
    renderDialog(TXN, ["reversal-1", "reversal-2"]);
    await open();

    expect(screen.getByTestId("already-reversed")).toHaveTextContent(
      "This transaction has already been reversed 2 times.",
    );
  });

  it("warns but does not block — reversing again is still permitted", async () => {
    // The API does not deduplicate reversals, so the console must not pretend
    // to. This is a warning, not a guard.
    reverseTransaction.mockResolvedValue({ id: "new-reversal" });
    renderDialog(TXN, ["reversal-1"]);
    await openAndConfirm();

    await waitFor(() => expect(reverseTransaction).toHaveBeenCalledTimes(1));
  });
});
