import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { WireAccount } from "@/features/accounts/account-display";
import { peekOperation } from "@/lib/ledger/idempotency";

const createTransaction = vi.fn();
const submitPending = vi.fn();
const navigate = vi.fn();

vi.mock("@/utils/orpc", () => ({
  client: {
    transactions: { create: (...args: unknown[]) => createTransaction(...args) },
    approvals: { submitPending: (...args: unknown[]) => submitPending(...args) },
  },
  orpc: {
    accounts: { list: { key: () => ["accounts", "list"] } },
    approvals: { listPending: { key: () => ["approvals", "listPending"] } },
    settings: {
      get: {
        queryOptions: () => ({
          queryKey: ["settings", "get"],
          queryFn: async () => ({ requireTransferApproval: false }),
        }),
      },
    },
  },
}));

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@tanstack/react-router");
  return { ...actual, useNavigate: () => navigate };
});

const { TransferForm } = await import("./transfer-form");

function account(overrides: Partial<WireAccount> = {}): WireAccount {
  return {
    id: "acc-1",
    name: "Operating",
    currency: "USD",
    type: "normal",
    balance: { amount: "100.00", currency: "USD" },
    active: true,
    createdAt: "2026-07-28T00:00:00.000Z",
    ...overrides,
  };
}

const ACCOUNTS = [
  account({ id: "src", name: "Operating" }),
  account({ id: "dst", name: "Employee A" }),
];

function renderForm({ strict = false }: { strict?: boolean } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  const tree = (
    <QueryClientProvider client={queryClient}>
      <TransferForm accounts={ACCOUNTS} />
    </QueryClientProvider>
  );
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree);
}

beforeEach(() => {
  createTransaction.mockReset();
  submitPending.mockReset();
  navigate.mockReset();
  globalThis.sessionStorage.clear();
});

describe("idempotency key lifecycle", () => {
  it("mints exactly one key under StrictMode's double-invoked effects", async () => {
    // React 19 StrictMode runs effects twice in development. A key minted per
    // effect, or per render, would make a retry a *second posting* rather than
    // a replay — and nothing upstream dedupes it, because the server's request
    // hash deliberately excludes the idempotency key (ADR 0006).
    const randomUUID = vi.spyOn(globalThis.crypto, "randomUUID");
    renderForm({ strict: true });

    await waitFor(() => {
      expect(peekOperation("transfer", sessionKeyStore())).not.toBeNull();
    });

    // `startOperation` is idempotent: it writes only when the slot is empty.
    expect(randomUUID).toHaveBeenCalledTimes(1);
    randomUUID.mockRestore();
  });

  it("keeps the same key across a failed submit, so resubmitting is a replay", async () => {
    createTransaction.mockRejectedValue({
      code: "UNPROCESSABLE_CONTENT",
      status: 422,
      message: "Insufficient funds.",
      data: { reason: "insufficient_funds" },
    });

    renderForm();
    await waitFor(() => expect(peekOperation("transfer", sessionKeyStore())).not.toBeNull());
    const keyBefore = peekOperation("transfer", sessionKeyStore());

    await submitTransfer();

    await waitFor(() => expect(screen.getByText("Not enough funds")).toBeInTheDocument());

    // ADR 0004: the user fixes the amount and resubmits under the SAME key, so
    // the server treats it as one operation. A fresh key here posts twice.
    expect(peekOperation("transfer", sessionKeyStore())).toBe(keyBefore);
  });

  it("sends the persisted key with the request", async () => {
    createTransaction.mockResolvedValue({ id: "txn-1" });
    renderForm();
    await waitFor(() => expect(peekOperation("transfer", sessionKeyStore())).not.toBeNull());
    const key = peekOperation("transfer", sessionKeyStore());

    await submitTransfer();

    await waitFor(() => expect(createTransaction).toHaveBeenCalledTimes(1));
    expect(createTransaction.mock.calls[0]?.[0]).toMatchObject({ idempotencyKey: key });
  });

  it("releases the slot after a successful post so the next transfer is a new operation", async () => {
    createTransaction.mockResolvedValue({ id: "txn-1" });
    renderForm();
    await waitFor(() => expect(peekOperation("transfer", sessionKeyStore())).not.toBeNull());

    await submitTransfer();

    await waitFor(() => expect(navigate).toHaveBeenCalled());
    expect(peekOperation("transfer", sessionKeyStore())).toBeNull();
  });
});

describe("the payload", () => {
  it("debits the destination and credits the source", async () => {
    createTransaction.mockResolvedValue({ id: "txn-1" });
    renderForm();
    await submitTransfer();

    await waitFor(() => expect(createTransaction).toHaveBeenCalledTimes(1));
    const payload = createTransaction.mock.calls[0]?.[0] as {
      postings: { accountId: string; direction: string; amount: string }[];
    };

    // The failure the server cannot catch: an inverted array still nets to
    // zero, still posts, and still reconciles — it just moves the money the
    // wrong way.
    expect(payload.postings).toEqual([
      { accountId: "dst", direction: "debit", amount: "12.50", currency: "USD" },
      { accountId: "src", direction: "credit", amount: "12.50", currency: "USD" },
    ]);
  });
});

describe("confirmation step", () => {
  it("names the direction in plain language before anything is posted", async () => {
    renderForm();
    await fillTransfer();
    await userEvent.click(screen.getByRole("button", { name: "Review transfer" }));

    expect(
      screen.getByText("Move 12.50 USD out of Operating and into Employee A."),
    ).toBeInTheDocument();
    // Nothing has been sent yet — reviewing is not posting.
    expect(createTransaction).not.toHaveBeenCalled();
  });

  it("offers an explicit start-over on an idempotency conflict, and never retries silently", async () => {
    createTransaction.mockRejectedValue({
      code: "CONFLICT",
      status: 409,
      message: "Key reused.",
      data: { reason: "idempotency_conflict" },
    });

    renderForm();
    await waitFor(() => expect(peekOperation("transfer", sessionKeyStore())).not.toBeNull());
    const keyBefore = peekOperation("transfer", sessionKeyStore());

    await submitTransfer();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Start a new transfer" })).toBeInTheDocument(),
    );

    // Exactly one attempt: the key is spent on a different payload, so a
    // retry under it can never succeed and an automatic one would be a
    // double-post waiting to happen.
    expect(createTransaction).toHaveBeenCalledTimes(1);
    expect(peekOperation("transfer", sessionKeyStore())).toBe(keyBefore);

    await userEvent.click(screen.getByRole("button", { name: "Start a new transfer" }));
    expect(peekOperation("transfer", sessionKeyStore())).not.toBe(keyBefore);
  });
});

/** The same slot the component writes to, read directly. */
function sessionKeyStore() {
  return {
    read: (slot: string) => globalThis.sessionStorage.getItem(slot),
    write: (slot: string, value: string) => globalThis.sessionStorage.setItem(slot, value),
    clear: (slot: string) => globalThis.sessionStorage.removeItem(slot),
  };
}

async function fillTransfer() {
  const user = userEvent.setup();
  await user.click(screen.getByLabelText("From"));
  await user.click(await screen.findByRole("option", { name: /Operating/ }));
  await user.click(screen.getByLabelText("To"));
  await user.click(await screen.findByRole("option", { name: /Employee A/ }));
  await user.type(screen.getByLabelText("Amount"), "12.50");
}

async function submitTransfer() {
  await fillTransfer();
  await userEvent.click(screen.getByRole("button", { name: "Review transfer" }));
  await userEvent.click(screen.getByRole("button", { name: "Post transfer" }));
}
