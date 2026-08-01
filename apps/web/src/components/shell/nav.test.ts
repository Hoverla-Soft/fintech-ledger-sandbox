import { describe, expect, it } from "vitest";

import { findNavItem, NAV_GROUPS, NAV_ITEMS } from "./nav";

describe("findNavItem", () => {
  it("resolves a console route to its group and label", () => {
    expect(findNavItem("/reconciliation")).toEqual({
      group: "Assurance",
      item: expect.objectContaining({ label: "Reconciliation", to: "/reconciliation" }),
    });
  });

  it("resolves the overview only on the console root", () => {
    expect(findNavItem("/")).toEqual({
      group: "Ledger",
      item: expect.objectContaining({ label: "Overview", to: "/" }),
    });
    // `/` is a prefix of every path; a careless match would claim every screen.
    expect(findNavItem("/accounts")?.item.label).toBe("Accounts");
  });

  it("resolves a detail route to the section that owns it", () => {
    // Detail routes have no nav entry of their own. Without the prefix match
    // the breadcrumb would render blank on exactly the screens where knowing
    // where you are matters most.
    expect(findNavItem("/accounts/acc_01H8XYZ")?.item.label).toBe("Accounts");
    expect(findNavItem("/transactions/11111111-2222-3333-4444-555555555555")?.item.label).toBe(
      "History",
    );
  });

  it("does not match a sibling route that merely shares a prefix", () => {
    expect(findNavItem("/accountsomething")).toBeNull();
  });

  it("returns null for a route outside the console", () => {
    expect(findNavItem("/login")).toBeNull();
    expect(findNavItem("/organization")).toBeNull();
  });
});

describe("the route map", () => {
  it("declares every destination exactly once", () => {
    const paths = NAV_ITEMS.map((item) => item.to);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("gives every entry a hint, because the palette searches them", () => {
    for (const item of NAV_ITEMS) {
      expect(item.hint.length).toBeGreaterThan(0);
    }
  });

  it("keeps the flat list in group order", () => {
    expect(NAV_ITEMS).toEqual(NAV_GROUPS.flatMap((group) => group.items));
  });
});
