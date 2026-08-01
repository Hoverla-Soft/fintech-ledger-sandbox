import { CURRENCIES } from "@fintech-ledger-sandbox/core";
import { Button } from "@fintech-ledger-sandbox/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@fintech-ledger-sandbox/ui/components/dialog";
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
import { useState } from "react";
import { toast } from "sonner";

import { type DescribedFailure, describeFailure, keepsFormOpen } from "@/lib/ledger/errors";
import { client, orpc } from "@/utils/orpc";
import { type FieldErrors, toFieldErrors } from "./field-errors";

/**
 * Create an account.
 *
 * This is the console's first write, and it is deliberately the *cheapest* one
 * in the API: `accounts.create` takes no idempotency key and writes no audit
 * entry (`docs/adr/0006-write-endpoint-contract.md`), and its worst outcome is
 * a duplicate name. Every mistake in this pipeline — closing too early,
 * swallowing a reason, forgetting to invalidate — is recoverable here and is a
 * double-posted payroll in 5d. So the pipeline is proven here first.
 */

type AccountType = "normal" | "external";

export function CreateAccountDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState<string>("USD");
  const [type, setType] = useState<AccountType>("normal");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<DescribedFailure | null>(null);

  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const create = useMutation({
    mutationFn: (input: { name: string; currency: string; type: AccountType }) =>
      client.accounts.create(input),

    onSuccess: async (account) => {
      // Invalidate rather than write into the cache by hand: the created row
      // is not the only thing that changed from the list's point of view, and
      // the server is the authority on what the list contains.
      await queryClient.invalidateQueries({ queryKey: orpc.accounts.list.key() });

      // Only now is it safe to close. `ledger.md` requires the dialog close
      // *after* the request resolves — closing on submit would show a success
      // the server has not agreed to.
      setOpen(false);
      resetForm();
      toast.success(`Created ${account.name}`);
      await navigate({ to: "/accounts/$accountId", params: { accountId: account.id } });
    },

    onError: (error) => {
      const failure = describeFailure(error);
      setFieldErrors(toFieldErrors(failure));

      if (keepsFormOpen(failure)) {
        // Fixable or transient: stay open, keep what they typed, show why.
        setFormError(failure);
        return;
      }

      // `insufficient_role`, or a session failure. The form cannot fix it, so
      // close and let the mutation cache's toast carry the message.
      setOpen(false);
      resetForm();
    },
  });

  function resetForm() {
    setName("");
    setCurrency("USD");
    setType("normal");
    setFieldErrors({});
    setFormError(null);
  }

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    // Clear prior server errors so a stale `account_name_taken` does not sit
    // under a name the user has since changed.
    setFieldErrors({});
    setFormError(null);
    create.mutate({ name: name.trim(), currency, type });
  }

  const nameTooLong = name.trim().length > 120;
  const nameEmpty = name.trim().length === 0;
  const clientNameError = nameTooLong ? "Name must be at most 120 characters." : undefined;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Never let a dismiss race an in-flight request: the account may still
        // be created, and the user would be looking at a list that does not
        // show it yet with no idea whether it worked.
        if (create.isPending) {
          return;
        }
        setOpen(next);
        if (!next) {
          resetForm();
        }
      }}
    >
      <Button onClick={() => setOpen(true)}>New account</Button>

      <DialogContent>
        <form onSubmit={onSubmit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>New account</DialogTitle>
            <DialogDescription>
              An account is a named balance in a single currency. Its currency cannot be changed
              later.
            </DialogDescription>
          </DialogHeader>

          <Field>
            <FieldLabel htmlFor="account-name">Name</FieldLabel>
            <Input
              {...fieldControlProps({
                id: "account-name",
                errorId: "account-name-error",
                hasError: Boolean(fieldErrors.name ?? clientNameError),
              })}
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={create.isPending}
              autoComplete="off"
            />
            <FieldError id="account-name-error" message={fieldErrors.name ?? clientNameError} />
          </Field>

          <Field>
            <FieldLabel htmlFor="account-currency">Currency</FieldLabel>
            {/*
              Base UI reports `null` when a select is cleared. Currency and
              type are both required by the API, so a cleared value is held at
              the last valid one rather than propagated as an empty string the
              server would reject with a 400.
            */}
            <Select value={currency} onValueChange={(value) => setCurrency(value ?? currency)}>
              <SelectTrigger
                {...fieldControlProps({
                  id: "account-currency",
                  errorId: "account-currency-error",
                  hasError: Boolean(fieldErrors.currency),
                  describedById: "account-currency-help",
                })}
                disabled={create.isPending}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CURRENCIES.map((code) => (
                  <SelectItem key={code} value={code}>
                    {code}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldDescription id="account-currency-help">
              Only currencies whose minor-unit scale this ledger knows.
            </FieldDescription>
            <FieldError id="account-currency-error" message={fieldErrors.currency} />
          </Field>

          <Field>
            <FieldLabel htmlFor="account-type">Type</FieldLabel>
            <Select value={type} onValueChange={(value) => setType((value as AccountType) ?? type)}>
              <SelectTrigger
                {...fieldControlProps({
                  id: "account-type",
                  errorId: "account-type-error",
                  hasError: Boolean(fieldErrors.type),
                  describedById: "account-type-help",
                })}
                disabled={create.isPending}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="normal">normal</SelectItem>
                <SelectItem value="external">external</SelectItem>
              </SelectContent>
            </Select>
            <FieldDescription id="account-type-help">
              A normal account can never go negative. An external account represents money entering
              or leaving the sandbox, and may.
            </FieldDescription>
            <FieldError id="account-type-error" message={fieldErrors.type} />
          </Field>

          {formError && !fieldErrors.name && !fieldErrors.currency ? (
            <p role="alert" className="text-sm text-destructive">
              {formError.detail}
              {formError.rateLimit?.retryAfterSeconds !== undefined
                ? ` Try again in about ${formError.rateLimit.retryAfterSeconds} seconds.`
                : null}
            </p>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={create.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending || nameEmpty || nameTooLong}>
              {create.isPending ? "Creating…" : "Create account"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
