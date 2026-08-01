import { Badge } from "@fintech-ledger-sandbox/ui/components/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@fintech-ledger-sandbox/ui/components/table";

export interface WirePosting {
  readonly id: string;
  readonly accountId: string;
  readonly direction: "debit" | "credit";
  readonly amount: { readonly amount: string; readonly currency: string };
  readonly createdAt: string;
}

/**
 * A transaction's legs as a journal — debit and credit columns, with the
 * balance made visible.
 *
 * The net-to-zero row is not decoration. "Money is conserved" is invariant #1;
 * showing both sides and their equality lets a person *see* it hold.
 */
export function PostingsTable({
  postings,
  accountNames,
}: {
  postings: readonly WirePosting[];
  accountNames: ReadonlyMap<string, string>;
}) {
  const totals = sumByDirection(postings);
  const currency = postings[0]?.amount.currency ?? "";
  const balanced = totals.debits === totals.credits;

  return (
    <div className="space-y-3">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Account</TableHead>
            <TableHead className="text-right">Debit</TableHead>
            <TableHead className="text-right">Credit</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {postings.map((posting) => (
            <TableRow key={posting.id}>
              <TableCell>
                {accountNames.get(posting.accountId) ?? (
                  <span className="font-mono text-xs">{posting.accountId}</span>
                )}
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {posting.direction === "debit"
                  ? `${posting.amount.amount} ${posting.amount.currency}`
                  : "—"}
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {posting.direction === "credit"
                  ? `${posting.amount.amount} ${posting.amount.currency}`
                  : "—"}
              </TableCell>
            </TableRow>
          ))}
          <TableRow className="border-t-2 font-medium">
            <TableCell>Totals</TableCell>
            <TableCell className="text-right font-mono tabular-nums">
              {formatFromDigits(totals.debits, totals.scale)} {currency}
            </TableCell>
            <TableCell className="text-right font-mono tabular-nums">
              {formatFromDigits(totals.credits, totals.scale)} {currency}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>

      <div
        className="flex items-center justify-between rounded-none border p-3 text-sm"
        data-testid="net-to-zero-proof"
      >
        <span className="text-muted-foreground">Journal integrity</span>
        {balanced ? (
          <Badge variant="success">Nets to zero</Badge>
        ) : (
          <Badge variant="destructive">Does not balance</Badge>
        )}
      </div>
    </div>
  );
}

/**
 * Sums debits and credits as integers.
 *
 * Legs are rescaled to a common fraction width first. Skipping that would be a
 * false-pass bug rather than an imprecision: `"1.0"` and `"10"` both reduce to
 * the digits `10`, so an unscaled comparison would report a transaction as
 * balanced when the two sides differ by nine units.
 */
export function sumByDirection(postings: readonly WirePosting[]): {
  debits: bigint;
  credits: bigint;
  scale: number;
} {
  const parts = postings.map((posting) => decompose(posting.amount.amount));
  const scale = parts.reduce((widest, part) => Math.max(widest, part.fraction.length), 0);

  let debits = 0n;
  let credits = 0n;

  parts.forEach((part, index) => {
    const magnitude = BigInt(`${part.integer}${part.fraction.padEnd(scale, "0")}`);
    const signed = part.negative ? -magnitude : magnitude;
    if (postings[index]?.direction === "debit") {
      debits += signed;
    } else {
      credits += signed;
    }
  });

  return { debits, credits, scale };
}

function decompose(decimal: string): { negative: boolean; integer: string; fraction: string } {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(decimal);
  if (match === null) {
    return { negative: false, integer: "0", fraction: "" };
  }
  const [, sign = "", integer = "0", fraction = ""] = match;
  return { negative: sign === "-", integer, fraction };
}

/** Renders an integer digit-string back at the scale it was summed at. */
function formatFromDigits(value: bigint, scale: number): string {
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(scale + 1, "0");
  const sign = negative ? "-" : "";
  if (scale === 0) {
    return `${sign}${digits}`;
  }
  return `${sign}${digits.slice(0, digits.length - scale)}.${digits.slice(digits.length - scale)}`;
}
