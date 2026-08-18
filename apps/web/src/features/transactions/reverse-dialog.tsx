import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@fintech-ledger-sandbox/ui/components/alert-dialog";
import { Button } from "@fintech-ledger-sandbox/ui/components/button";
import { Field, FieldLabel, fieldControlProps } from "@fintech-ledger-sandbox/ui/components/field";
import { Input } from "@fintech-ledger-sandbox/ui/components/input";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { type DescribedFailure, describeFailure } from "@/lib/ledger/errors";
import {
  completeOperation,
  createSessionKeyStore,
  newOperation,
  startOperation,
} from "@/lib/ledger/idempotency";
import { client, orpc } from "@/utils/orpc";

/** Typed to confirm. Deliberately not "yes" — it should be impossible to do by muscle memory. */
export const CONFIRMATION_WORD = "REVERSE";

/**
 * Reverse a transaction.
 *
 * ## The already-reversed warning
 *
 * `reversesTransactionId` is a **forward** pointer — it records that a
 * transaction *is* a reversal, never that one *has been* reversed. Until Phase
 * 6b there was no way to ask the inverse question, so this dialog could only
 * disclose its own blindness: *"this console cannot tell whether this
 * transaction has already been reversed"*.
 *
 * `reversedBy` (6b, open question #3) closes that. The warning now states
 * what is actually true of *this* transaction, which is what
 * `docs/adr/0006-write-endpoint-contract.md` assumed all along.
 *
 * **What changed on 2026-08-16, and what this comment used to get wrong.** It
 * said reversing was "still permitted and still not deduplicated". Migration
 * `0007` made the partial unique index on `reverses_transaction_id` unique, so
 * a transaction is now reversible at most once and a second attempt is refused
 * with `409 already_reversed`. Reversing a *reversal* is still permitted — that
 * targets a different id, and is legitimate undo/redo.
 *
 * The warning still informs rather than blocks, but for a different reason than
 * before: the server is the arbiter (open question #1), so the console states
 * the rule and lets the refusal come from the place that enforces it. Typing
 * the confirmation word keeps this a deliberate act rather than a reflex.
 */
export function ReverseDialog({
  transactionId,
  reversedBy,
  onReversed,
}: {
  transactionId: string;
  /**
   * Ids of transactions already reversing this one, from `transactions.get`.
   * Empty is the common case. Required rather than optional: an omitted prop
   * would default to "not reversed", which is the exact false reassurance this
   * warning exists to prevent.
   */
  reversedBy: readonly string[];
  onReversed?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [failure, setFailure] = useState<DescribedFailure | null>(null);

  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const keyStore = useRef(createSessionKeyStore()).current;

  // Scoped per transaction, so reversing A and reversing B never share a slot
  // and cannot collide as a false `409`.
  const operation = `reverse:${transactionId}` as const;

  const reverse = useMutation({
    mutationFn: () =>
      client.transactions.reverse({
        // Only these two fields. The server rebuilds the mirrored legs from
        // the persisted rows precisely so there is nothing here to tamper
        // with — sending postings would be both rejected and meaningless.
        transactionId,
        idempotencyKey: startOperation(operation, keyStore),
      }),

    // A reversal moves money. It is never retried automatically.
    retry: false,

    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: orpc.accounts.list.key() });
      await queryClient.invalidateQueries({ queryKey: orpc.transactions.list.key() });
      completeOperation(operation, keyStore);
      setOpen(false);
      setTyped("");
      toast.success("Reversal posted");
      onReversed?.();
      await navigate({
        to: "/transactions/$transactionId",
        params: { transactionId: created.id },
      });
    },

    onError: (error) => {
      const described = describeFailure(error);
      setFailure(described);

      if (described.reason === "idempotency_conflict") {
        // This key is spent on a different payload and can never succeed.
        // Minting here is safe and correct: the user has already expressed
        // intent to reverse this transaction, and the conflict means the
        // previous attempt was a *different* operation.
        newOperation(operation, keyStore);
      }
    },
  });

  const confirmed = typed.trim() === CONFIRMATION_WORD;

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Reverse
      </Button>

      <AlertDialog
        open={open}
        onOpenChange={(next) => {
          if (reverse.isPending) {
            return;
          }
          setOpen(next);
          if (!next) {
            setTyped("");
            setFailure(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reverse this transaction?</AlertDialogTitle>
            <AlertDialogDescription>
              This posts a new, mirrored transaction. The original is not edited or removed —
              history is append-only, so a correction is always a new entry.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-2 rounded-none border border-destructive/50 p-3 text-sm">
            {/*
             * Both branches used to warn that "reversals are not deduplicated"
             * and that a second one "will succeed". That stopped being true on
             * 2026-08-16, when open question #3 was closed by migration
             * `0007`: a partial unique index on `reverses_transaction_id`
             * makes a transaction reversible at most once, and a second
             * attempt is refused with `409 already_reversed`.
             *
             * Left uncorrected it was worse than stale — a false statement
             * about a money operation, on that operation's own confirmation
             * screen, warning in the wrong direction: it told an admin a
             * double correction would go through when the server now refuses
             * it.
             */}
            {reversedBy.length > 0 ? (
              <>
                <p className="font-medium text-destructive" data-testid="already-reversed">
                  This transaction has already been reversed.
                </p>
                <p className="text-muted-foreground">
                  A transaction can be reversed only once, so this will be refused. To undo the
                  reversal itself, open it and reverse <em>that</em> — a correction is always a new
                  entry.
                </p>
              </>
            ) : (
              <>
                <p className="font-medium">This can be done only once.</p>
                <p className="text-muted-foreground">
                  Reversing posts a mirrored transaction and applies the correction. A second
                  reversal of this same transaction will be refused, so the correction cannot be
                  applied twice by accident.
                </p>
              </>
            )}
          </div>

          <Field>
            <FieldLabel htmlFor="reverse-confirm">Type {CONFIRMATION_WORD} to confirm</FieldLabel>
            <Input
              {...fieldControlProps({
                id: "reverse-confirm",
                errorId: "reverse-confirm-error",
                hasError: false,
              })}
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              disabled={reverse.isPending}
              autoComplete="off"
            />
          </Field>

          {failure ? (
            <p role="alert" className="text-sm text-destructive">
              {failure.title}. {failure.detail}
            </p>
          ) : null}

          <AlertDialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={reverse.isPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={!confirmed || reverse.isPending}
              onClick={() => reverse.mutate()}
            >
              {reverse.isPending ? "Reversing…" : "Post reversal"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
