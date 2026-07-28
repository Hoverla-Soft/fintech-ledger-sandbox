import { createFileRoute } from "@tanstack/react-router";

import { SandboxControls } from "@/features/sandbox/sandbox-controls";
import { useOrgContext } from "@/lib/org/session";

export const Route = createFileRoute("/_auth/sandbox")({
  component: SandboxRoute,
});

function SandboxRoute() {
  const { canWrite } = useOrgContext();

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Sandbox</h1>
        <p className="text-sm text-muted-foreground">
          Fake money, real bookkeeping. Populate this organization with a set of realistic
          transactions, or unwind every balance back to zero.
        </p>
      </div>

      {canWrite ? (
        <SandboxControls />
      ) : (
        <p className="rounded-none border border-dashed p-6 text-center text-sm text-muted-foreground">
          Seeding and resetting need an admin role in this organization.
        </p>
      )}
    </div>
  );
}
