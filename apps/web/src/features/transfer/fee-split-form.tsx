import { Button } from "@fintech-ledger-sandbox/ui/components/button";
import { Field, FieldDescription, FieldLabel } from "@fintech-ledger-sandbox/ui/components/field";
import { Input } from "@fintech-ledger-sandbox/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@fintech-ledger-sandbox/ui/components/select";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import type { WireAccount } from "@/features/accounts/account-display";
import { formatMinorUnits, parseAmount } from "@/lib/ledger/amount";
import { type DescribedFailure, describeFailure, keepsFormOpen } from "@/lib/ledger/errors";
import {
  completeOperation,
  createSessionKeyStore,
  newOperation,
  startOperation,
} from "@/lib/ledger/idempotency";
import { client, orpc } from "@/utils/orpc";

import { AMOUNT_MESSAGES } from "./submission";

/**
 * N-leg marketplace-style fee split.
 *
 * Posts one balanced transaction: debit funding, credit merchant (gross − fee),
 * credit fee account. Demonstrates the write contract's N-posting shape without
 * requiring the sandbox seed.
 */
export function FeeSplitForm({ accounts }: { accounts: readonly WireAccount[] }) {
  const open = useMemo(() => accounts.filter((a) => a.active), [accounts]);
  const [fundingId, setFundingId] = useState("");
  const [merchantId, setMerchantId] = useState("");
  const [feeId, setFeeId] = useState("");
  const [gross, setGross] = useState("");
  const [fee, setFee] = useState("");
  const [failure, setFailure] = useState<DescribedFailure | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const queryClient = useQueryClient();
  const navigate = useNavigate();

  /**
   * A fee split is a transfer — it moves money through `transactions.create`,
   * exactly like the Transfer form — so the org's maker-checker flag applies to
   * it. This screen ignored the flag entirely until 2026-08-16, which meant an
   * org with approvals switched on could still post immediately just by using
   * the other form. Fails closed for the same reason the transfer form does.
   */
  const settings = useQuery(orpc.settings.get.queryOptions());
  const settingsUnknown = settings.data === undefined;
  const requireApproval = settings.data?.requireTransferApproval === true;

  const keyStore = useRef(createSessionKeyStore()).current;
  const [idempotencyKey, setIdempotencyKey] = useState("");

  useEffect(() => {
    setIdempotencyKey(startOperation("fee-split", keyStore));
  }, [keyStore]);

  const funding = open.find((a) => a.id === fundingId) ?? null;
  const sameCurrency = useMemo(() => {
    if (!funding) {
      return open;
    }
    return open.filter((a) => a.currency === funding.currency && a.id !== funding.id);
  }, [open, funding]);

  const post = useMutation({
    mutationFn: async (input: {
      idempotencyKey: string;
      postings: Array<{
        accountId: string;
        direction: "debit" | "credit";
        amount: string;
        currency: string;
      }>;
    }) => {
      if (requireApproval) {
        return {
          kind: "pending" as const,
          pending: await client.approvals.submitPending({
            idempotencyKey: input.idempotencyKey,
            postings: input.postings,
          }),
        };
      }
      return {
        kind: "posted" as const,
        transaction: await client.transactions.create({
          idempotencyKey: input.idempotencyKey,
          postings: input.postings,
        }),
      };
    },
    retry: false,
    onSuccess: async (result) => {
      completeOperation("fee-split", keyStore);

      if (result.kind === "pending") {
        await queryClient.invalidateQueries({ queryKey: orpc.approvals.listPending.key() });
        toast.success("Fee split submitted for approval", {
          description: "A different admin has to approve it before any balance moves.",
        });
        await navigate({ to: "/approvals" });
        return;
      }

      await queryClient.invalidateQueries({ queryKey: orpc.accounts.list.key() });
      if (result.transaction.replayed) {
        toast.success("Fee split replayed", {
          description: "Same idempotency key — no second posting.",
        });
      } else {
        toast.success("Fee split posted");
      }
      await navigate({
        to: "/transactions/$transactionId",
        params: { transactionId: result.transaction.id },
      });
    },
    onError: (error) => {
      const described = describeFailure(error);
      setFailure(described);
      if (!keepsFormOpen(described)) {
        return;
      }
    },
  });

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFailure(null);
    setLocalError(null);

    if (!funding || !merchantId || !feeId) {
      setLocalError("Choose funding, merchant, and fee accounts.");
      return;
    }
    if (new Set([fundingId, merchantId, feeId]).size !== 3) {
      setLocalError("Funding, merchant, and fee accounts must be distinct.");
      return;
    }

    const grossParsed = parseAmount(gross, funding.currency);
    const feeParsed = parseAmount(fee, funding.currency);
    if (!grossParsed.ok) {
      setLocalError(AMOUNT_MESSAGES[grossParsed.problem] ?? "That amount cannot be used.");
      return;
    }
    if (!feeParsed.ok) {
      setLocalError(AMOUNT_MESSAGES[feeParsed.problem] ?? "That amount cannot be used.");
      return;
    }
    if (grossParsed.minorUnits <= 0n) {
      setLocalError("Enter a gross amount greater than zero.");
      return;
    }
    if (feeParsed.minorUnits <= 0n || feeParsed.minorUnits >= grossParsed.minorUnits) {
      setLocalError("Fee must be positive and less than the gross amount.");
      return;
    }

    const netMinor = grossParsed.minorUnits - feeParsed.minorUnits;

    post.mutate({
      idempotencyKey,
      postings: [
        {
          accountId: fundingId,
          direction: "debit",
          amount: formatMinorUnits(grossParsed.minorUnits, funding.currency),
          currency: funding.currency,
        },
        {
          accountId: merchantId,
          direction: "credit",
          amount: formatMinorUnits(netMinor, funding.currency),
          currency: funding.currency,
        },
        {
          accountId: feeId,
          direction: "credit",
          amount: formatMinorUnits(feeParsed.minorUnits, funding.currency),
          currency: funding.currency,
        },
      ],
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5" data-testid="fee-split-form">
      <p className="text-sm text-muted-foreground">
        Posts three legs in one commit: debit the funding account for the gross, credit the merchant
        net of fee, credit the fee account. All three succeed together or nothing posts.
      </p>

      <AccountSelect
        id="fee-funding"
        label="Funding"
        accounts={open}
        value={fundingId}
        onChange={setFundingId}
        disabled={post.isPending}
      />
      <AccountSelect
        id="fee-merchant"
        label="Merchant"
        accounts={sameCurrency}
        value={merchantId}
        onChange={setMerchantId}
        disabled={post.isPending || !funding}
      />
      <AccountSelect
        id="fee-platform"
        label="Fee account"
        accounts={sameCurrency.filter((a) => a.id !== merchantId)}
        value={feeId}
        onChange={setFeeId}
        disabled={post.isPending || !funding}
      />

      <Field>
        <FieldLabel htmlFor="fee-gross">Gross amount</FieldLabel>
        <Input
          id="fee-gross"
          value={gross}
          onChange={(e) => setGross(e.target.value)}
          disabled={post.isPending || !funding}
          inputMode="decimal"
          placeholder={funding ? `Amount in ${funding.currency}` : ""}
        />
      </Field>

      <Field>
        <FieldLabel htmlFor="fee-amount">Platform fee</FieldLabel>
        <Input
          id="fee-amount"
          value={fee}
          onChange={(e) => setFee(e.target.value)}
          disabled={post.isPending || !funding}
          inputMode="decimal"
        />
        <FieldDescription>
          Must be less than the gross. Merchant receives gross − fee.
        </FieldDescription>
      </Field>

      {localError ? (
        <p role="alert" className="text-sm text-destructive">
          {localError}
        </p>
      ) : null}

      {failure ? (
        <div role="alert" className="space-y-2 rounded-none border border-destructive/50 p-3">
          <p className="text-sm font-medium text-destructive">{failure.title}</p>
          <p className="text-sm text-muted-foreground">{failure.detail}</p>
          {failure.reason === "idempotency_conflict" ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setIdempotencyKey(newOperation("fee-split", keyStore));
                setFailure(null);
              }}
            >
              Start a new split
            </Button>
          ) : null}
        </div>
      ) : null}

      {/*
        The label states which operation the button performs. "Post fee split"
        that silently queues for approval is the same lie as a button that
        posts when the user expected review — and this screen has no review
        step to reveal the difference before the money does or does not move.
      */}
      <Button type="submit" disabled={post.isPending || settingsUnknown}>
        {settingsUnknown
          ? "Checking approval policy…"
          : post.isPending
            ? requireApproval
              ? "Submitting…"
              : "Posting…"
            : requireApproval
              ? "Submit fee split for approval"
              : "Post fee split"}
      </Button>
    </form>
  );
}

function AccountSelect({
  id,
  label,
  accounts,
  value,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  accounts: readonly WireAccount[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select value={value} onValueChange={(v) => onChange(v ?? value)}>
        <SelectTrigger id={id} disabled={disabled}>
          <SelectValue placeholder="Choose an account">
            {(selected) => {
              const account = accounts.find((a) => a.id === selected);
              return account
                ? `${account.name} — ${account.balance.amount} ${account.currency}`
                : "";
            }}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {accounts.map((account) => (
            <SelectItem key={account.id} value={account.id}>
              {account.name} — {account.balance.amount} {account.currency}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}
