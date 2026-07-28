import { expect, test } from "@playwright/test";

import { signUpAndCreateOrg, uniqueTenant } from "./support/tenant";

/**
 * Sign-up → organization → console.
 *
 * Automates the manual demo script Phase 5b carried (`docs/tasks/archive/2026/
 * 2026-07-28-phase-5b-tenant-gate.md`). The property under test is the tenant
 * gate in `_auth/route.tsx`: a session with **no active organization** is a
 * normal state, and the console must route that user to org creation rather
 * than to an error or a half-rendered console.
 */

test("an unauthenticated visitor is sent to login, not to a broken console", async ({ page }) => {
  await page.goto("/accounts");

  await page.waitForURL(/\/login/);
  await expect(page.getByRole("button", { name: "Sign Up" })).toBeVisible();
});

test("a new user signs up, is routed to org creation, and reaches the console", async ({
  page,
}) => {
  const tenant = uniqueTenant("onboarding");

  await signUpAndCreateOrg(page, tenant);

  // The org-scoped nav is the observable proof the gate let the user through
  // with an active organization, not merely a session.
  await expect(page.getByRole("link", { name: "Accounts" })).toBeVisible();
  await expect(page.getByRole("link", { name: "History" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Transfer" })).toBeVisible();
});
