import { env } from "@fintech-ledger-sandbox/env/web";
import { Button } from "@fintech-ledger-sandbox/ui/components/button";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";

export const Route = createFileRoute("/_auth/api")({
  component: ApiPlaygroundRoute,
});

/**
 * In-console doorway to the typed API.
 *
 * The full OpenAPI reference already lives on the server; this screen frames it
 * for a demo and offers a copy-paste transfer sample so engineering buyers see
 * platform surface, not only the admin UI.
 */
function ApiPlaygroundRoute() {
  const docsUrl = useMemo(() => {
    const base = env.VITE_SERVER_URL.replace(/\/$/, "");
    return `${base}/api-reference`;
  }, []);

  const sample = `curl -X POST '${env.VITE_SERVER_URL.replace(/\/$/, "")}/rpc/transactions/create' \\
  -H 'content-type: application/json' \\
  -H 'cookie: <session>' \\
  -d '{
    "idempotencyKey": "demo-transfer-001",
    "postings": [
      { "accountId": "<source>", "direction": "debit", "amount": "25.00" },
      { "accountId": "<destination>", "direction": "credit", "amount": "25.00" }
    ]
  }'`;

  const [copied, setCopied] = useState(false);

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">API</h1>
        <p className="text-sm text-muted-foreground">
          The console is one client of a typed oRPC surface. Open the interactive reference, or copy
          a balanced transfer sample.
        </p>
      </div>

      <section className="space-y-3 rounded-none border p-4">
        <h2 className="font-medium">OpenAPI reference</h2>
        <p className="text-sm text-muted-foreground">
          Scalar UI generated from the same contracts the console uses.
        </p>
        <Button render={<a href={docsUrl} target="_blank" rel="noreferrer" />}>
          Open API reference
        </Button>
        <p className="break-all font-mono text-xs text-muted-foreground">{docsUrl}</p>
      </section>

      <section className="space-y-3 rounded-none border p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-medium">Sample: post a transfer</h2>
            <p className="text-sm text-muted-foreground">
              Idempotent, balanced, org-scoped. Replace account ids and send the session cookie.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={async () => {
              await navigator.clipboard.writeText(sample);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <pre className="overflow-x-auto rounded-none border bg-muted/40 p-3 text-xs">{sample}</pre>
      </section>
    </div>
  );
}
