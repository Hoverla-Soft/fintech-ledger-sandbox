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
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import { client, orpc } from "@/utils/orpc";

import { exchangeDestinations, exchangeSources, previewConversion } from "./conversion";

/**
 * Post a cross-currency exchange.
 *
 * Deliberately a **separate screen** from the transfer form rather than a second
 * mode inside it. The two have opposite eligibility rules (a transfer needs the
 * currencies to match, an exchange needs them to differ), different inputs, and
 * different failure modes; folding them together would mean every one of the
 * transfer form's load-bearing behaviours had to be re-verified against a branch
 * it was never written for.
 *
 * What *is* shared is the idempotency discipline, and it is shared by using the
 * same module rather than by copying it: a key minted when the form opens, held
 * across failed submits so a retry is a replay, and re-minted only on an explicit
 * "start over". A cross-currency exchange moves money twice, so a double-post
 * here is twice as bad as on a transfer.
 *
 * ## The preview is the submission
 *
 * The converted amount shown on screen is the exact value sent to the server,
 * computed with `packages/core`'s own `convert`. Showing one number and
 * submitting another — or letting the user type the target amount freely — is how
 * you get a form that fails `conversion_mismatch` with no way to tell which side
 * is wrong.
 */

type FieldName = "amount" | "rate" | "source" | "destination";

/**
 * What a picker's trigger shows once something is chosen.
 *
 * Base UI's `Select.Value` renders the raw `value` unless given a function, so
 * without this the trigger displayed the account's **uuid** — which is both
 * unreadable and, on a screen that moves money, actively unsafe: it is the one
 * place someone should be able to confirm they picked the right account.
 */
function labelFor(accounts: readonly WireAccount[], value: unknown): string {
  const chosen = accounts.find((account) => account.id === value);
  return chosen === undefined ? "" : `${chosen.name} — ${chosen.balance.amount} ${chosen.currency}`;
}

export function ExchangeForm({ accounts }: { accounts: readonly WireAccount[] }) {
  const [sourceId, setSourceId] = useState("");
  const [destinationId, setDestinationId] = useState("");
  const [amount, setAmount] = useState("");
  const [rate, setRate] = useState("");
  const [localError, setLocalError] = useState<{ field: FieldName; message: string } | null>(null);
  const [serverFailure, setServerFailure] = useState<DescribedFailure | null>(null);

  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const keyStore = useRef(createSessionKeyStore()).current;

  // Minted when the form opens, never during render and never per submit — see
  // the transfer form's note on why. `startOperation` is idempotent, so React
  // 19 StrictMode's double-invoked effect is safe.
  const [idempotencyKey, setIdempotencyKey] = useState("");
  useEffect(() => {
    setIdempotencyKey(startOperation("exchange", keyStore));
  }, [keyStore]);

  const sources = useMemo(() => exchangeSources(accounts), [accounts]);
  const source = useMemo(
    () => sources.find((account) => account.id === sourceId) ?? null,
    [sources, sourceId],
  );
  const destinations = useMemo(() => exchangeDestinations(accounts, source), [accounts, source]);
  const destination = useMemo(
    () => destinations.find((account) => account.id === destinationId) ?? null,
    [destinations, destinationId],
  );

  // Changing the source can invalidate the destination — it may now share the
  // source's currency, which an exchange forbids.
  useEffect(() => {
    if (destinationId && !destinations.some((account) => account.id === destinationId)) {
      setDestinationId("");
    }
  }, [destinations, destinationId]);

  const preview = useMemo(
    () => previewConversion(source, destination, amount, rate),
    [source, destination, amount, rate],
  );

  const post = useMutation({
    mutationFn: (input: {
      idempotencyKey: string;
      fromAccountId: string;
      toAccountId: string;
      amount: string;
      rate: string;
      targetAmount: string;
    }) => client.transactions.exchange(input),

    // Never automatically — an exchange moves money on two accounts.
    retry: false,

    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: orpc.accounts.list.key() });
      await queryClient.invalidateQueries({ queryKey: orpc.transactions.list.key() });
      completeOperation("exchange", keyStore);
      toast.success("Exchange posted");
      // Lands on the *source* leg: it is the transaction the user asked for, and
      // its detail page links forward to the target through the FX link.
      await navigate({
        to: "/transactions/$transactionId",
        params: { transactionId: result.source.id },
        search: { play: true },
      });
    },

    onError: (error) => {
      const failure = describeFailure(error);
      setServerFailure(failure);
      if (!keepsFormOpen(failure)) {
        return;
      }
      // Everything else leaves the form populated and the key untouched, so
      // resubmitting replays one operation rather than starting a second.
    },
  });

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setServerFailure(null);

    if (source === null) {
      setLocalError({ field: "source", message: "Choose the account money leaves." });
      return;
    }
    if (destination === null) {
      setLocalError({ field: "destination", message: "Choose the account money arrives in." });
      return;
    }
    if (!preview.ok) {
      setLocalError(localErrorFor(preview.problem));
      return;
    }

    setLocalError(null);
    post.mutate({
      idempotencyKey,
      fromAccountId: source.id,
      toAccountId: destination.id,
      amount: amount.trim(),
      rate: rate.trim(),
      // The figure on screen, not a re-derivation.
      targetAmount: preview.targetAmount,
    });
  }

  /**
   * The only sanctioned way to abandon a key — reached from
   * `409 idempotency_conflict`, where this key has already been spent on a
   * different payload and no retry under it can succeed. Requires a click; a
   * silent re-mint is the double-post this discipline exists to prevent.
   */
  function onStartOver() {
    setIdempotencyKey(newOperation("exchange", keyStore));
    setServerFailure(null);
    setAmount("");
    setRate("");
  }

  const errorFor = (field: FieldName) =>
    localError?.field === field ? localError.message : undefined;
  const isConflict = serverFailure?.reason === "idempotency_conflict";

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <Field>
        <FieldLabel htmlFor="exchange-source">From</FieldLabel>
        <Select value={sourceId} onValueChange={(value) => setSourceId(value ?? sourceId)}>
          <SelectTrigger
            {...fieldControlProps({
              id: "exchange-source",
              errorId: "exchange-source-error",
              hasError: Boolean(errorFor("source")),
            })}
            disabled={post.isPending}
          >
            <SelectValue placeholder="Choose an account">
              {(value) => labelFor(sources, value)}
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
        <FieldError id="exchange-source-error" message={errorFor("source")} />
      </Field>

      <Field>
        <FieldLabel htmlFor="exchange-destination">To</FieldLabel>
        <Select
          value={destinationId}
          onValueChange={(value) => setDestinationId(value ?? destinationId)}
        >
          <SelectTrigger
            {...fieldControlProps({
              id: "exchange-destination",
              errorId: "exchange-destination-error",
              hasError: Boolean(errorFor("destination")),
              describedById: "exchange-destination-help",
            })}
            disabled={post.isPending || source === null}
          >
            <SelectValue placeholder={source ? "Choose an account" : "Choose a source first"}>
              {(value) => labelFor(destinations, value)}
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
        <FieldDescription id="exchange-destination-help">
          Only open accounts in a <em>different</em> currency. Same-currency moves are an ordinary
          transfer.
        </FieldDescription>
        <FieldError id="exchange-destination-error" message={errorFor("destination")} />
      </Field>

      <Field>
        <FieldLabel htmlFor="exchange-amount">
          Amount{source ? ` (${source.currency})` : ""}
        </FieldLabel>
        <Input
          {...fieldControlProps({
            id: "exchange-amount",
            errorId: "exchange-amount-error",
            hasError: Boolean(errorFor("amount")),
          })}
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          placeholder="0.00"
          inputMode="decimal"
          autoComplete="off"
          disabled={post.isPending}
        />
        <FieldError id="exchange-amount-error" message={errorFor("amount")} />
      </Field>

      <Field>
        <FieldLabel htmlFor="exchange-rate">Rate</FieldLabel>
        <Input
          {...fieldControlProps({
            id: "exchange-rate",
            errorId: "exchange-rate-error",
            hasError: Boolean(errorFor("rate")),
            describedById: "exchange-rate-help",
          })}
          value={rate}
          onChange={(event) => setRate(event.target.value)}
          placeholder="0.92"
          inputMode="decimal"
          autoComplete="off"
          disabled={post.isPending}
        />
        <FieldDescription id="exchange-rate-help">
          {source && destination
            ? `How many ${destination.currency} one ${source.currency} buys. This sandbox has no
               market data — the rate is whatever you agree.`
            : "How many units of the target currency one unit of the source buys."}
        </FieldDescription>
        <FieldError id="exchange-rate-error" message={errorFor("rate")} />
      </Field>

      <ConversionSummary
        preview={preview}
        sourceCurrency={source?.currency ?? null}
        amount={amount}
      />

      {serverFailure ? (
        <div role="alert" className="space-y-2 rounded-none border border-destructive p-3 text-sm">
          <p className="font-medium">{serverFailure.title}</p>
          <p className="text-muted-foreground">{serverFailure.detail}</p>
          {isConflict ? (
            <Button type="button" variant="outline" size="sm" onClick={onStartOver}>
              Start over with a new key
            </Button>
          ) : null}
        </div>
      ) : null}

      <Button type="submit" disabled={post.isPending || !preview.ok}>
        {post.isPending ? "Posting…" : "Post exchange"}
      </Button>
    </form>
  );
}

/**
 * What the exchange will actually do, in words and figures.
 *
 * Shown before submission because an exchange is the one write in this console
 * where the amount arriving is not the amount typed. Someone confirming "100.00
 * USD becomes 92.00 EUR" is confirming the thing that will happen; someone
 * confirming "100.00" at "0.92" is doing arithmetic in their head.
 */
function ConversionSummary({
  preview,
  sourceCurrency,
  amount,
}: {
  preview: ReturnType<typeof previewConversion>;
  sourceCurrency: string | null;
  amount: string;
}) {
  if (!preview.ok) {
    return (
      <p className="rounded-none border border-dashed p-3 text-muted-foreground text-sm">
        {describeProblem(preview.problem)}
      </p>
    );
  }

  return (
    <div className="rounded-none border p-3 text-sm" aria-live="polite">
      <p>
        <span className="font-mono tabular-nums">
          {amount.trim()} {sourceCurrency}
        </span>{" "}
        becomes{" "}
        <span className="font-mono font-semibold tabular-nums">
          {preview.targetAmount} {preview.targetCurrency}
        </span>
      </p>
      <p className="mt-1 text-muted-foreground text-xs">
        Rounded to {preview.targetCurrency}&apos;s smallest unit. This exact figure is what gets
        posted — the server recomputes it from the rate and refuses anything else.
      </p>
    </div>
  );
}

/** Guidance for a preview that cannot be computed yet. Never an alarm — most of these are just "keep typing". */
function describeProblem(
  problem: ReturnType<typeof previewConversion> extends { ok: true } ? never : string,
): string {
  switch (problem) {
    case "no-source":
      return "Choose the account money leaves.";
    case "no-target":
      return "Choose the account money arrives in.";
    case "same-currency":
      return "Both accounts hold the same currency — use a transfer instead.";
    case "invalid-amount":
      return "Enter an amount at the source currency's scale.";
    case "invalid-rate":
      return "Enter a positive rate, for example 0.92.";
    default:
      return "That currency is not supported.";
  }
}

/** The field a preview problem belongs to, so the message lands next to the input that caused it. */
function localErrorFor(problem: string): { field: FieldName; message: string } {
  if (problem === "invalid-rate") {
    return { field: "rate", message: describeProblem(problem) };
  }
  if (problem === "same-currency") {
    return { field: "destination", message: describeProblem(problem) };
  }
  return { field: "amount", message: describeProblem(problem) };
}
