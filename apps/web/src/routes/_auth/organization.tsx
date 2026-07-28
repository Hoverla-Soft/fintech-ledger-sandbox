import { Button } from "@fintech-ledger-sandbox/ui/components/button";
import { Input } from "@fintech-ledger-sandbox/ui/components/input";
import { Label } from "@fintech-ledger-sandbox/ui/components/label";
import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import z from "zod";

import { EmptyState } from "@/components/states";
import { authClient } from "@/lib/auth-client";
import { describeFailure } from "@/lib/ledger/errors";
import { switchOrganization, useOrganizations, useOrgContext } from "@/lib/org/session";

/**
 * Organization bootstrap and switching.
 *
 * Deliberately **outside** the `_auth` layout's active-org requirement in
 * spirit, though it sits under it: the guard redirects here precisely when
 * there is no active org, so this route must render usefully in that state
 * rather than bouncing back. It is the one console screen that assumes nothing
 * about tenancy.
 */
export const Route = createFileRoute("/_auth/organization")({
  component: OrganizationRoute,
});

function OrganizationRoute() {
  const { org } = useOrgContext();
  const { data: organizations, isPending } = useOrganizations();
  const queryClient = useQueryClient();
  const router = useRouter();
  const navigate = useNavigate();

  const form = useForm({
    defaultValues: { name: "" },
    validators: {
      onSubmit: z.object({
        name: z.string().min(1, "Name is required").max(120, "Name must be at most 120 characters"),
      }),
    },
    onSubmit: async ({ value, formApi }) => {
      // A slug is required by Better Auth and is not a product concept here,
      // so it is derived rather than asked for. Suffixed with a short random
      // component because slugs are globally unique and two orgs called
      // "Acme" in one sandbox is an entirely reasonable thing to want.
      const slug = `${slugify(value.name)}-${Math.random().toString(36).slice(2, 8)}`;

      const created = await authClient.organization.create({ name: value.name, slug });

      if (created.error) {
        // The form stays open with the reason inline — `ledger.md:75`.
        const failure = describeFailure(created.error);
        toast.error(failure.title, { description: failure.detail });
        return;
      }

      // Creating an org does not make it active; without this the user would
      // be redirected straight back here by the `_auth` guard.
      await switchOrganization(created.data.id, queryClient, () => router.invalidate());
      formApi.reset();
      toast.success(`Created ${value.name}`);
      await navigate({ to: "/dashboard" });
    },
  });

  const hasOrganizations = (organizations?.length ?? 0) > 0;

  return (
    <div className="mx-auto w-full max-w-lg space-y-8 py-8">
      <div>
        <h1 className="text-2xl font-bold">Organizations</h1>
        <p className="text-sm text-muted-foreground">
          Every account, transaction, and balance belongs to one organization and is invisible to
          every other. Create a second one to see that isolation for yourself.
        </p>
      </div>

      {!isPending && !hasOrganizations ? (
        <EmptyState
          title="No organizations yet"
          description="You need one before the ledger has anywhere to put accounts."
          action={<p className="text-sm text-muted-foreground">Create your first one below.</p>}
        />
      ) : null}

      {hasOrganizations ? (
        <section className="space-y-2">
          <h2 className="text-sm font-medium">Your organizations</h2>
          <ul className="divide-y rounded-none border">
            {(organizations ?? []).map((candidate) => (
              <li key={candidate.id} className="flex items-center justify-between px-3 py-2">
                <span>{candidate.name}</span>
                {candidate.id === org?.id ? (
                  <span className="text-xs text-muted-foreground">Active</span>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      void switchOrganization(candidate.id, queryClient, () =>
                        router.invalidate(),
                      ).then(() => navigate({ to: "/dashboard" }));
                    }}
                  >
                    Switch to
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void form.handleSubmit();
        }}
      >
        <form.Field name="name">
          {(field) => (
            <div className="space-y-2">
              <Label htmlFor={field.name}>New organization name</Label>
              <Input
                id={field.name}
                name={field.name}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
              {field.state.meta.errors.map((error) => (
                <p key={error?.message} className="text-sm text-destructive">
                  {error?.message}
                </p>
              ))}
            </div>
          )}
        </form.Field>

        <form.Subscribe
          selector={(state) => ({ canSubmit: state.canSubmit, isSubmitting: state.isSubmitting })}
        >
          {({ canSubmit, isSubmitting }) => (
            <Button type="submit" disabled={!canSubmit || isSubmitting}>
              {isSubmitting ? "Creating…" : "Create organization"}
            </Button>
          )}
        </form.Subscribe>
      </form>
    </div>
  );
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "org"
  );
}
