import { toLedgerRole as serverToLedgerRole } from "@fintech-ledger-sandbox/api/auth/roles";
import { describe, expect, it } from "vitest";

import { canWrite, toLedgerRole } from "./role";

/**
 * The console duplicates the server's role mapping because no procedure
 * returns the caller's role (open question #1). Duplication is only safe while
 * the two provably agree, so this file asserts that directly — importing the
 * server's own function and comparing outputs, rather than restating its rules
 * and hoping.
 */
describe("agreement with packages/api", () => {
  it.each([
    "owner",
    "admin",
    "member",
    "",
    "viewer",
    "OWNER",
    "Admin",
    " owner ",
    "admin,member",
    "member,admin",
    "member,guest",
    "guest",
    "administrator",
    "ownerish",
    "owner,admin",
    ",",
    "  ",
  ])("maps %j the same way the server does", (input) => {
    expect(toLedgerRole(input)).toBe(serverToLedgerRole(input));
  });
});

describe("toLedgerRole", () => {
  it("grants admin for the two write roles", () => {
    expect(toLedgerRole("owner")).toBe("admin");
    expect(toLedgerRole("admin")).toBe("admin");
  });

  it("takes the write role out of a comma-separated list", () => {
    expect(toLedgerRole("admin,member")).toBe("admin");
    expect(toLedgerRole("member,owner")).toBe("admin");
  });

  it("is case- and whitespace-insensitive", () => {
    expect(toLedgerRole(" Owner ")).toBe("admin");
    expect(toLedgerRole("ADMIN")).toBe("admin");
  });

  it("fails closed on anything unrecognised", () => {
    // Rendering a write affordance to someone the server will refuse is worse
    // than hiding one from someone who could have used it.
    for (const input of ["member", "", "guest", "administrator", "ownerish", "sudo"]) {
      expect(toLedgerRole(input)).toBe("viewer");
    }
  });

  it("fails closed on a missing value rather than throwing", () => {
    // Better Auth's session shape makes the member role optional, so this is
    // reachable during the window before a session resolves.
    expect(toLedgerRole(null)).toBe("viewer");
    expect(toLedgerRole(undefined)).toBe("viewer");
  });
});

describe("canWrite", () => {
  it("permits admin and refuses viewer", () => {
    expect(canWrite("admin")).toBe(true);
    expect(canWrite("viewer")).toBe(false);
  });
});
