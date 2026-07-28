import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigate = vi.fn();
const setTheme = vi.fn();
let canWrite = true;

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@tanstack/react-router");
  return { ...actual, useNavigate: () => navigate };
});

vi.mock("@/components/theme-provider", () => ({
  useTheme: () => ({ setTheme, theme: "system" }),
}));

vi.mock("@/lib/org/session", () => ({
  useOrgContext: () => ({
    org: { id: "org-1", name: "Acme" },
    role: canWrite ? "admin" : "viewer",
    canWrite,
    isPending: false,
  }),
}));

const { CommandPalette } = await import("./command-palette");

function open() {
  return render(<CommandPalette open onOpenChange={vi.fn()} />);
}

async function search(text: string) {
  const user = userEvent.setup();
  const input = screen.getByRole("combobox", { name: "Search commands" });
  await user.click(input);
  await user.type(input, text);
  return user;
}

beforeEach(() => {
  navigate.mockReset();
  setTheme.mockReset();
  canWrite = true;
});

describe("CommandPalette", () => {
  it("lists every console destination when nothing is typed", () => {
    open();
    for (const label of [
      "Overview",
      "Accounts",
      "Transfer",
      "History",
      "Reconciliation",
      "Audit",
      "Sandbox",
    ]) {
      expect(screen.getByRole("option", { name: new RegExp(label) })).toBeInTheDocument();
    }
  });

  it("finds a screen by what it does, not only by its name", async () => {
    // "drift" appears in the reconciliation hint and nowhere in its label. A
    // palette that only matches labels is a menu with extra steps.
    open();
    await search("drift");
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveAccessibleName(/Reconciliation/);
  });

  it("navigates with the keyboard alone", async () => {
    open();
    const user = await search("audit");
    await user.keyboard("{Enter}");
    expect(navigate).toHaveBeenCalledWith({ to: "/audit" });
  });

  it("moves the highlight with the arrow keys and commits the highlighted row", async () => {
    open();
    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox", { name: "Search commands" }));
    await user.keyboard("{ArrowDown}{Enter}");
    // First entry is Overview, so one step down commits the second.
    expect(navigate).toHaveBeenCalledWith({ to: "/accounts" });
  });

  it("performs an appearance command in place rather than navigating", async () => {
    open();
    const user = await search("dark");
    await user.keyboard("{Enter}");
    expect(setTheme).toHaveBeenCalledWith("dark");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("withholds write commands from a viewer", () => {
    canWrite = false;
    open();
    expect(screen.queryByRole("option", { name: /Post a transfer/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Reset balances/ })).not.toBeInTheDocument();
    // Reading is open to both roles, so the destinations themselves remain.
    expect(screen.getByRole("option", { name: /Transfer/ })).toBeInTheDocument();
  });

  it("offers write commands to an admin", () => {
    open();
    expect(screen.getByRole("option", { name: /Post a transfer/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Reset balances to zero/ })).toBeInTheDocument();
  });

  it("says so when nothing matches, instead of showing an empty box", async () => {
    open();
    await search("trial balance");
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByText(/No command matches/)).toBeInTheDocument();
  });

  it("never offers a capability the ledger does not have", () => {
    open();
    for (const absent of ["Trial balance", "Balance sheet", "Income statement", "Journal entry"]) {
      expect(
        screen.queryByRole("option", { name: new RegExp(absent, "i") }),
      ).not.toBeInTheDocument();
    }
  });
});
