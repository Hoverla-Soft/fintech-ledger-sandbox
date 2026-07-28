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

function renderDialog(transactionId = TXN) {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ReverseDialog transactionId={transactionId} />
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
    await user.type(screen.getByLabelText(`Type ${CONFIRMATION_WORD} to confirm`), CONFIRMATION_WORD);
    expect(screen.getByRole("button", { name: "Post reversal" })).toBeEnabled();
  });

  it("fires no mutation when dismissed", async () => {
    renderDialog();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Reverse" }));
    await user.type(screen.getByLabelText(`Type ${CONFIRMATION_WORD} to confirm`), CONFIRMATION_WORD);
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(reverseTransaction).not.toHaveBeenCalled();
  });

  it("states that reversals are not deduplicated, rather than claiming to check", async () => {
    // The API records that a transaction *is* a reversal, never that one *has
    // been* reversed — there is no reverse lookup (open question #3). The
    // dialog must not imply a check it cannot perform.
    renderDialog();
    await userEvent.click(screen.getByRole("button", { name: "Reverse" }));

    expect(screen.getByText(/not deduplicated/i)).toBeInTheDocument();
    expect(screen.getByText(/apply the correction twice/i)).toBeInTheDocument();
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
