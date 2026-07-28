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
 * ## What this dialog cannot tell you, and says so
 *
 * `reversesTransactionId` is a **forward** pointer: it records that a
 * transaction *is* a reversal, never that one *has been* reversed. There is no
 * reverse lookup, no filter, and `transactions.list` is forward-only and
 * capped at 200 rows, so the history cannot be walked to find out either
 * (open question #3).
 *
 * `docs/adr/0006-write-endpoint-contract.md` anticipates a console that warns
 * "this was already reversed". That capability does not exist. Rather than
 * imply a check it cannot perform, this dialog states the truth: reversing is
 * permitted, is not deduplicated, and doing it twice applies the correction
 * twice. Typing the confirmation word makes that a deliberate act rather than
 * a reflex.
 */
export function ReverseDialog({
  transactionId,
  onReversed,
}: {
  transactionId: string;
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
      await navigate({ to: "/transactions/$transactionId", params: { transactionId: created.id } });
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
            <p className="font-medium text-destructive">Reversals are not deduplicated.</p>
            <p className="text-muted-foreground">
              This console cannot tell whether this transaction has already been reversed — the API
              records that a transaction <em>is</em> a reversal, not that one <em>has</em> been
              reversed. Reversing twice will succeed both times and apply the correction twice.
            </p>
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
