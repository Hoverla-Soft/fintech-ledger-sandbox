import { Badge } from "@fintech-ledger-sandbox/ui/components/badge";
import { Button } from "@fintech-ledger-sandbox/ui/components/button";
import { Input } from "@fintech-ledger-sandbox/ui/components/input";
import { Label } from "@fintech-ledger-sandbox/ui/components/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@fintech-ledger-sandbox/ui/components/table";
import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import z from "zod";

import { EmptyState } from "@/components/states";
import { authClient } from "@/lib/auth-client";
import { describeFailure } from "@/lib/ledger/errors";
import { toLedgerRole } from "@/lib/org/role";
import { switchOrganization, useOrganizations, useOrgContext } from "@/lib/org/session";

export const Route = createFileRoute("/_auth/organization")({
  component: OrganizationRoute,
});

/**
 * Organization bootstrap, switching, and the admin/viewer permission matrix.
 */
function OrganizationRoute() {
  const { org, canWrite } = useOrgContext();
  const { data: organizations, isPending } = useOrganizations();
  const { data: activeOrganization } = authClient.useActiveOrganization();
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
      const slug = `${slugify(value.name)}-${Math.random().toString(36).slice(2, 8)}`;
      const created = await authClient.organization.create({ name: value.name, slug });

      if (created.error) {
        const failure = describeFailure(created.error);
        toast.error(failure.title, { description: failure.detail });
        return;
      }

      await switchOrganization(created.data.id, queryClient, () => router.invalidate());
      formApi.reset();
      toast.success(`Created ${value.name}`);
      await navigate({ to: "/" });
    },
  });

  const inviteForm = useForm({
    defaultValues: { email: "" },
    validators: {
      onSubmit: z.object({
        email: z.email("Enter a valid email"),
      }),
    },
    onSubmit: async ({ value, formApi }) => {
      if (!org) {
        return;
      }
      const invited = await authClient.organization.inviteMember({
        email: value.email,
        role: "member",
        organizationId: org.id,
      });
      if (invited.error) {
        const failure = describeFailure(invited.error);
        toast.error(failure.title, { description: failure.detail });
        return;
      }
      toast.success(`Invited ${value.email} as viewer (member)`);
      formApi.reset();
    },
  });

  const hasOrganizations = (organizations?.length ?? 0) > 0;
  const memberRows = activeOrganization?.members ?? [];

  return (
    <div className="mx-auto w-full max-w-2xl space-y-8 py-8">
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
                      ).then(() => navigate({ to: "/" }));
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

      {org ? (
        <section className="space-y-4 rounded-none border p-4" data-testid="role-matrix">
          <div>
            <h2 className="font-medium">Members & permissions</h2>
            <p className="text-sm text-muted-foreground">
              Better Auth roles map to ledger roles: owner/admin → write access; member → viewer.
            </p>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Capability</TableHead>
                <TableHead>Admin</TableHead>
                <TableHead>Viewer</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[
                ["Read balances, history, audit, reconciliation", "yes", "yes"],
                ["Create accounts / post transfers", "yes", "no"],
                ["Reverse transactions", "yes", "no"],
                ["Seed / reset sandbox", "yes", "no"],
              ].map(([cap, admin, viewer]) => (
                <TableRow key={cap}>
                  <TableCell>{cap}</TableCell>
                  <TableCell>
                    <Badge variant={admin === "yes" ? "success" : "muted"}>{admin}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={viewer === "yes" ? "success" : "muted"}>{viewer}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {memberRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Member list loads with the active organization session.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead>Auth role</TableHead>
                  <TableHead>Ledger role</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {memberRows.map((member) => {
                  const ledgerRole = toLedgerRole(member.role);
                  return (
                    <TableRow key={member.id}>
                      <TableCell>
                        <div className="text-sm">{member.user?.name ?? member.userId}</div>
                        <div className="text-xs text-muted-foreground">
                          {member.user?.email ?? member.userId}
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{member.role}</TableCell>
                      <TableCell>
                        <Badge variant={ledgerRole === "admin" ? "default" : "secondary"}>
                          {ledgerRole}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}

          {canWrite ? (
            <form
              className="space-y-3 border-t pt-4"
              onSubmit={(event) => {
                event.preventDefault();
                void inviteForm.handleSubmit();
              }}
            >
              <h3 className="text-sm font-medium">Invite viewer</h3>
              <inviteForm.Field name="email">
                {(field) => (
                  <div className="space-y-1.5">
                    <Label htmlFor="invite-email">Email</Label>
                    <Input
                      id="invite-email"
                      type="email"
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                    />
                  </div>
                )}
              </inviteForm.Field>
              <inviteForm.Subscribe
                selector={(state) => ({
                  canSubmit: state.canSubmit,
                  isSubmitting: state.isSubmitting,
                })}
              >
                {({ canSubmit, isSubmitting }) => (
                  <Button type="submit" size="sm" disabled={!canSubmit || isSubmitting}>
                    {isSubmitting ? "Inviting…" : "Send invite"}
                  </Button>
                )}
              </inviteForm.Subscribe>
            </form>
          ) : (
            <p className="text-sm text-muted-foreground">
              Inviting members needs an admin role. As a viewer you can still read the matrix above.
            </p>
          )}
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
