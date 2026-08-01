import { expect, test } from "@playwright/test";

import { signUpAndCreateOrg, uniqueTenant } from "./support/tenant";

/**
 * Portfolio demo spine: seed scenarios → outcomes table → integrity seal.
 *
 * Deliberately thinner than a full write-path suite: Select pickers are flaky
 * under Playwright here (see open question #9).
 */
test("sandbox seed surfaces scenario outcomes and the integrity seal", async ({ page }) => {
  const tenant = uniqueTenant("walkthrough");
  await signUpAndCreateOrg(page, tenant);

  await page.goto("/sandbox");
  await expect(page.getByRole("heading", { name: "Sandbox" })).toBeVisible();

  await page.getByRole("button", { name: "Run scenarios" }).click();
  await expect(page.getByTestId("scenario-outcomes")).toBeVisible({ timeout: 60_000 });

  // Sidebar + top bar both mount a seal; either proves ambient credibility.
  await expect(page.getByTestId("integrity-seal").first()).toBeVisible();
});
