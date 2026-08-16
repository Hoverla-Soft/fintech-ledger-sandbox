import { Button } from "@fintech-ledger-sandbox/ui/components/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  fieldControlProps,
} from "@fintech-ledger-sandbox/ui/components/field";
import { Input } from "@fintech-ledger-sandbox/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@fintech-ledger-sandbox/ui/components/select";
import { Separator } from "@fintech-ledger-sandbox/ui/components/separator";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import type { WireAccount } from "@/features/accounts/account-display";
import { type DescribedFailure, describeFailure, keepsFormOpen } from "@/lib/ledger/errors";
import {
  completeOperation,
  createSessionKeyStore,
  newOperation,
  startOperation,
} from "@/lib/ledger/idempotency";
import type { PostingInput } from "@/lib/ledger/postings";
import { client, orpc } from "@/utils/orpc";

import { eligibleDestinations, eligibleSources } from "./eligibility";
import { describeTransfer, prepareTransfer } from "./submission";

/**
 * Post a transfer.
 *
 * The console's first screen that moves money, and the first where being wrong
 * is not recoverable by trying again. Three things here are load-bearing and
 * none of them are visual.
 */

type FieldName = "amount" | "source" | "destination" | "form";

/**
 * What a picker's trigger shows once an account is chosen.
 *
 * Base UI's `Select.Value` renders the raw `value` unless handed a function, so
 * this trigger previously displayed the account's **uuid**. On the screen that
 * moves money, the trigger is the one place someone can confirm they picked the
 * account they meant — an id there is not a cosmetic problem.
 */
function accountLabel(accounts: readonly WireAccount[], value: unknown): string {
  const chosen = accounts.find((account) => account.id === value);
  return chosen === undefined ? "" : `${chosen.name} — ${chosen.balance.amount} ${chosen.currency}`;
}

export function TransferForm({ accounts }: { accounts: readonly WireAccount[] }) {
  const [sourceId, setSourceId] = useState<string>("");
  const [destinationId, setDestinationId] = useState<string>("");
  const [amount, setAmount] = useState("");
  const [localError, setLocalError] = useState<{ field: FieldName; message: string } | null>(null);
  const [serverFailure, setServerFailure] = useState<DescribedFailure | null>(null);
  const [pendingPostings, setPendingPostings] = useState<readonly PostingInput[] | null>(null);

  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const settings = useQuery(orpc.settings.get.queryOptions());
  /**
   * Neither guess is safe, so the form does not guess.
   *
   * This originally read `settings.data?.requireTransferApproval === true`,
   * which failed **open** — an in-flight or failed `settings.get` posted money
   * immediately. Inverting it to `!== false` fixed that and introduced the
   * mirror-image bug: an org with approvals *off* would have its transfer
   * parked in a queue nobody watches, needing a second admin to release money
   * the server would have posted directly.
   *
   * The honest answer is that until this read resolves, the form does not know
   * which operation the button performs — so it is disabled rather than
   * guessing. `settingsUnknown` drives that, and `requireApproval` is only ever
   * consulted once the value is known.
   */
  const settingsUnknown = settings.data === undefined;
  const requireApproval = settings.data?.requireTransferApproval === true;

  // One store for the component's lifetime. `createSessionKeyStore` probes
  // `sessionStorage` and falls back to a process-wide memory store, so calling
  // it repeatedly is safe — but holding it steady keeps the reads cheap.
  const keyStore = useRef(createSessionKeyStore()).current;

  /**
   * The idempotency key, minted **when the form opens** — not on submit, and
   * never during render.
   *
   * `startOperation` is idempotent (it returns the persisted key if one
   * exists), which is what makes this safe under React 19 StrictMode's
   * double-invoked effects. A key minted per render, or re-minted per submit,
   * would make a retry a *second posting* rather than a replay, and nothing
   * upstream would catch it: the server's request hash deliberately excludes
   * the idempotency key (`docs/adr/0006-write-endpoint-contract.md`).
   */
  const [idempotencyKey, setIdempotencyKey] = useState<string>("");
  useEffect(() => {
    setIdempotencyKey(startOperation("transfer", keyStore));
  }, [keyStore]);

  const sources = useMemo(() => eligibleSources(accounts), [accounts]);
  const source = useMemo(
    () => sources.find((account) => account.id === sourceId) ?? null,
    [sources, sourceId],
  );
  const destinations = useMemo(() => eligibleDestinations(accounts, source), [accounts, source]);
  const destination = useMemo(
    () => destinations.find((account) => account.id === destinationId) ?? null,
    [destinations, destinationId],
  );

  // Changing the source can invalidate the chosen destination — a different
  // currency, or the source itself. Clearing it is safer than submitting a
  // pair the pickers no longer consider valid.
  useEffect(() => {
    if (destinationId && !destinations.some((account) => account.id === destinationId)) {
      setDestinationId("");
    }
  }, [destinations, destinationId]);

  const post = useMutation({
    mutationFn: async (input: { idempotencyKey: string; postings: readonly PostingInput[] }) => {
      const postings = input.postings.map((posting) => ({ ...posting }));
      if (requireApproval) {
        return {
          kind: "pending" as const,
          pending: await client.approvals.submitPending({
            idempotencyKey: input.idempotencyKey,
            postings,
          }),
        };
      }
      return {
        kind: "posted" as const,
        transaction: await client.transactions.create({
          idempotencyKey: input.idempotencyKey,
          postings,
        }),
      };
    },

    // Never automatically. 5b's client default already sets this; it is
    // restated here because the cost of that default being loosened by someone
    // who has not read ADR 0006 is a double-posted transfer.
    retry: false,

    onSuccess: async (result) => {
      completeOperation("transfer", keyStore);
      setPendingPostings(null);
      if (result.kind === "pending") {
        await queryClient.invalidateQueries({ queryKey: orpc.approvals.listPending.key() });
        toast.success(
          result.pending.replayed ? "Pending request replayed" : "Submitted for approval",
          {
            description: "A different admin must approve before balances move.",
          },
        );
        await navigate({ to: "/approvals" });
        return;
      }
      await queryClient.invalidateQueries({ queryKey: orpc.accounts.list.key() });
      if (result.transaction.replayed) {
        toast.success("Transfer replayed", {
          description: "Same idempotency key — no second posting.",
        });
      } else {
        toast.success("Transfer posted");
      }
      await navigate({
        to: "/transactions/$transactionId",
        params: { transactionId: result.transaction.id },
      });
    },

    onError: (error) => {
      const failure = describeFailure(error);
      setServerFailure(failure);
      setPendingPostings(null);

      if (!keepsFormOpen(failure)) {
        // `403 insufficient_role`, or a session failure. The mutation cache
        // toasts it; the form cannot fix it.
        return;
      }
      // Everything else — insufficient funds, a bad amount, a throttle —
      // leaves the form populated and the key untouched, so resubmitting is a
      // replay of one operation rather than a second one (ADR 0004).
    },
  });

  function onReview(event: React.FormEvent) {
    event.preventDefault();
    setServerFailure(null);

    const prepared = prepareTransfer({
      sourceAccountId: sourceId,
      destinationAccountId: destinationId,
      amount,
      currency: source?.currency ?? "",
    });

    if (!prepared.ok) {
      setLocalError({ field: prepared.field, message: prepared.message });
      setPendingPostings(null);
      return;
    }

    setLocalError(null);
    setPendingPostings(prepared.postings);
  }

  function onConfirm() {
    if (pendingPostings === null || post.isPending) {
      return;
    }
    post.mutate({ idempotencyKey, postings: pendingPostings });
  }

  /**
   * The only sanctioned way to abandon a key.
   *
   * Reached from `409 idempotency_conflict`, which means this key has already
   * been spent on a *different* payload — no retry under it can ever succeed.
   * Requires an explicit click: a silent re-mint here is precisely the
   * double-post the whole module exists to prevent.
   */
  function onStartOver() {
    setIdempotencyKey(newOperation("transfer", keyStore));
    setServerFailure(null);
    setPendingPostings(null);
    setAmount("");
  }

  const errorFor = (field: FieldName) =>
    localError?.field === field ? localError.message : undefined;

  const isConflict = serverFailure?.reason === "idempotency_conflict";

  return (
    <form onSubmit={onReview} className="space-y-5">
      <Field>
        <FieldLabel htmlFor="transfer-source">From</FieldLabel>
        <Select value={sourceId} onValueChange={(value) => setSourceId(value ?? sourceId)}>
          <SelectTrigger
            {...fieldControlProps({
              id: "transfer-source",
              errorId: "transfer-source-error",
              hasError: Boolean(errorFor("source")),
            })}
            disabled={post.isPending}
          >
            <SelectValue placeholder="Choose an account">
              {(value) => accountLabel(sources, value)}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {sources.map((account) => (
              <SelectItem key={account.id} value={account.id}>
                {account.name} — {account.balance.amount} {account.currency}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldError id="transfer-source-error" message={errorFor("source")} />
      </Field>

      <Field>
        <FieldLabel htmlFor="transfer-destination">To</FieldLabel>
        <Select
          value={destinationId}
          onValueChange={(value) => setDestinationId(value ?? destinationId)}
        >
          <SelectTrigger
            {...fieldControlProps({
              id: "transfer-destination",
              errorId: "transfer-destination-error",
              hasError: Boolean(errorFor("destination")),
              describedById: "transfer-destination-help",
            })}
            disabled={post.isPending || source === null}
          >
            <SelectValue placeholder={source ? "Choose an account" : "Choose a source first"}>
              {(value) => accountLabel(destinations, value)}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {destinations.map((account) => (
              <SelectItem key={account.id} value={account.id}>
                {account.name} — {account.balance.amount} {account.currency}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldDescription id="transfer-destination-help">
          Only open accounts in the same currency — this sandbox does not convert between
          currencies.
        </FieldDescription>
        <FieldError id="transfer-destination-error" message={errorFor("destination")} />
      </Field>

      <Field>
        <FieldLabel htmlFor="transfer-amount">Amount</FieldLabel>
        <Input
          {...fieldControlProps({
            id: "transfer-amount",
            errorId: "transfer-amount-error",
            hasError: Boolean(errorFor("amount")),
          })}
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          disabled={post.isPending || source === null}
          inputMode="decimal"
          autoComplete="off"
          placeholder={source ? `Amount in ${source.currency}` : ""}
        />
        <FieldError id="transfer-amount-error" message={errorFor("amount")} />
      </Field>

      {idempotencyKey ? (
        <div
          className="space-y-2 rounded-none border border-dashed p-3 text-sm"
          data-testid="idempotency-panel"
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-medium">Idempotency</p>
              <p className="text-xs text-muted-foreground">
                This key is minted when the form opens. Retrying with the same key replays the same
                write — it will not double-post.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={post.isPending || pendingPostings === null}
              onClick={onConfirm}
              title="Submit again with the same key to demonstrate safe retry"
            >
              Simulate retry
            </Button>
          </div>
          <p className="break-all font-mono text-xs text-muted-foreground">{idempotencyKey}</p>
        </div>
      ) : null}

      {errorFor("form") ? (
        <p role="alert" className="text-sm text-destructive">
          {errorFor("form")}
        </p>
      ) : null}

      {serverFailure ? (
        <div role="alert" className="space-y-2 rounded-none border border-destructive/50 p-3">
          <p className="text-sm font-medium text-destructive">{serverFailure.title}</p>
          <p className="text-sm text-muted-foreground">
            {serverFailure.detail}
            {serverFailure.rateLimit?.retryAfterSeconds !== undefined
              ? ` Try again in about ${serverFailure.rateLimit.retryAfterSeconds} seconds.`
              : null}
          </p>
          {isConflict ? (
            <Button type="button" variant="outline" size="sm" onClick={onStartOver}>
              Start a new transfer
            </Button>
          ) : null}
        </div>
      ) : null}

      {pendingPostings === null ? (
        <Button type="submit" disabled={post.isPending || settingsUnknown}>
          {settingsUnknown ? "Checking approval policy…" : "Review transfer"}
        </Button>
      ) : (
        <div className="space-y-3 rounded-none border p-4">
          <Separator />
          {/*
            The human half of the defence against a balanced-but-inverted
            array. The machine proves the legs sum to zero; only a person can
            confirm the money is going the way they meant. There is no
            `data.reason` for a backwards transfer, because from the server's
            view nothing is wrong.
          */}
          <p className="font-medium">
            {describeTransfer({
              sourceName: source?.name ?? "",
              destinationName: destination?.name ?? "",
              amount,
              currency: source?.currency ?? "",
            })}
          </p>
          <p className="text-sm text-muted-foreground">
            {requireApproval
              ? "This org requires a second admin to approve before balances move. You cannot approve your own submission."
              : "Check the direction before posting. A transfer cannot be edited afterwards — it can only be corrected by a reversal."}
          </p>
          <div className="flex gap-2">
            <Button type="button" onClick={onConfirm} disabled={post.isPending}>
              {post.isPending
                ? requireApproval
                  ? "Submitting…"
                  : "Posting…"
                : requireApproval
                  ? "Submit for approval"
                  : "Post transfer"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setPendingPostings(null)}
              disabled={post.isPending}
            >
              Back
            </Button>
          </div>
        </div>
      )}
    </form>
  );
}
