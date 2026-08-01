import {
  ArrowLeftRight,
  BookOpen,
  CheckSquare,
  FlaskConical,
  LayoutDashboard,
  type LucideIcon,
  Repeat,
  Scale,
  ScrollText,
  ShieldCheck,
  Wallet,
} from "lucide-react";

/**
 * The console's route map, declared once.
 *
 * Destinations are declared once in this list and read by the sidebar, the
 * breadcrumb, and the palette, so a screen added later cannot end up reachable
 * only by typing its URL.
 */

export type ConsolePath =
  | "/"
  | "/accounts"
  | "/transfer"
  | "/exchange"
  | "/transactions"
  | "/reconciliation"
  | "/approvals"
  | "/audit"
  | "/sandbox"
  | "/api";

export interface NavItem {
  readonly to: ConsolePath;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly hint: string;
}

export interface NavGroup {
  readonly label: string;
  readonly items: readonly NavItem[];
}

export const NAV_GROUPS: readonly NavGroup[] = [
  {
    label: "Ledger",
    items: [
      {
        to: "/",
        label: "Overview",
        icon: LayoutDashboard,
        hint: "Balances and recent activity for this organization",
      },
      {
        to: "/accounts",
        label: "Accounts",
        icon: Wallet,
        hint: "Every account, its type, currency and balance",
      },
      {
        to: "/transfer",
        label: "Transfer",
        icon: ArrowLeftRight,
        hint: "Post a balanced transaction between accounts",
      },
      {
        to: "/exchange",
        label: "Exchange",
        icon: Repeat,
        hint: "Convert between currencies at a rate you state",
      },
      {
        to: "/transactions",
        label: "History",
        icon: ScrollText,
        hint: "Transactions and their postings, newest first",
      },
    ],
  },
  {
    label: "Assurance",
    items: [
      {
        to: "/reconciliation",
        label: "Reconciliation",
        icon: Scale,
        hint: "Verify every balance against its posting history, and find drift",
      },
      {
        to: "/approvals",
        label: "Approvals",
        icon: CheckSquare,
        hint: "Pending transfers waiting for a second admin",
      },
      {
        to: "/audit",
        label: "Audit",
        icon: ShieldCheck,
        hint: "The audit log and every recorded rejection",
      },
    ],
  },
  {
    label: "Environment",
    items: [
      {
        to: "/sandbox",
        label: "Sandbox",
        icon: FlaskConical,
        hint: "Seed the demo scenarios, or unwind every balance to zero",
      },
      {
        to: "/api",
        label: "API",
        icon: BookOpen,
        hint: "OpenAPI reference and a sample transfer against the typed RPC",
      },
    ],
  },
];

/** Flat order, for the palette and for breadcrumb lookup. */
export const NAV_ITEMS: readonly NavItem[] = NAV_GROUPS.flatMap((group) => group.items);

/**
 * Which nav entry a pathname belongs to.
 *
 * Longest match wins, so `/accounts/acc_123` resolves to Accounts rather than
 * failing to resolve at all — detail routes have no nav entry of their own and
 * still need to say where they are.
 */
export function findNavItem(pathname: string): { group: string; item: NavItem } | null {
  let best: { group: string; item: NavItem } | null = null;

  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      const matches =
        item.to === "/"
          ? pathname === "/"
          : pathname === item.to || pathname.startsWith(`${item.to}/`);
      if (matches && (best === null || item.to.length > best.item.to.length)) {
        best = { group: group.label, item };
      }
    }
  }

  return best;
}
