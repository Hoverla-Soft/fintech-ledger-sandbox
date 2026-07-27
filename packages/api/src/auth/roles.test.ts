import { describe, expect, it } from "vitest";

import { canWrite, toLedgerRole } from "./roles";

describe("toLedgerRole", () => {
  it("maps Better Auth's owner and admin to the ledger admin role", () => {
    expect(toLedgerRole("owner")).toBe("admin");
    expect(toLedgerRole("admin")).toBe("admin");
  });

  it("maps Better Auth's member to viewer", () => {
    expect(toLedgerRole("member")).toBe("viewer");
  });

  it("fails closed: any unrecognized role is a viewer, never an admin", () => {
    // The failure mode that matters. A role string this mapping does not
    // recognize — a future Better Auth default, a typo, a hand-edited column —
    // must never grant write access to a ledger.
    for (const unknown of ["", " ", "guest", "superuser", "ADMIN_", "administrator", "0", "null"]) {
      expect(toLedgerRole(unknown)).toBe("viewer");
    }
  });

  it("is case-insensitive", () => {
    expect(toLedgerRole("OWNER")).toBe("admin");
    expect(toLedgerRole("Admin")).toBe("admin");
  });

  it("tolerates surrounding whitespace", () => {
    expect(toLedgerRole("  admin  ")).toBe("admin");
  });

  describe("multi-role values", () => {
    // Better Auth allows a member to hold several roles in one column as a
    // comma-separated list. A whole-string comparison would match none of
    // them and silently demote a genuine admin to viewer.
    it("grants admin when any role in the list is a write role", () => {
      expect(toLedgerRole("admin,member")).toBe("admin");
      expect(toLedgerRole("member,owner")).toBe("admin");
      expect(toLedgerRole("member, admin")).toBe("admin");
    });

    it("stays viewer when no role in the list is a write role", () => {
      expect(toLedgerRole("member,guest")).toBe("viewer");
    });
  });
});

describe("canWrite", () => {
  it("permits admin and refuses viewer", () => {
    expect(canWrite("admin")).toBe(true);
    expect(canWrite("viewer")).toBe(false);
  });
});
