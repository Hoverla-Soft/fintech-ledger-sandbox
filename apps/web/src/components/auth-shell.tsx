import type { ReactNode } from "react";

import { LedgerMark } from "@/components/shell/ledger-mark";
import { SandboxBadge } from "@/components/shell/sandbox-badge";

/**
 * Shared chrome for sign-in / sign-up.
 *
 * The console already carries `LedgerMark` and the sandbox honesty line; auth
 * used to look like a different product (generic "Create Account"). This shell
 * makes the first paint match the instrument the visitor is about to enter.
 */
export function AuthShell({
  title,
  children,
  footer,
}: {
  title: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-8 px-6 py-12 sm:py-16">
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="flex items-center gap-2.5 text-primary">
          <LedgerMark className="size-6" />
          <span className="text-lg font-semibold tracking-tight text-foreground">
            Ledger sandbox
          </span>
        </div>
        <SandboxBadge withDescription />
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="text-sm text-muted-foreground">
            Fake money. Real correctness — every transfer is a balanced set of postings, balances
            reconcile, and no organization can see another&apos;s data.
          </p>
        </div>
      </div>

      <div className="space-y-4">{children}</div>
      <div className="text-center">{footer}</div>
    </div>
  );
}
