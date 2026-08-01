import { expect, test } from "@playwright/test";

import { signUpAndCreateOrg, uniqueTenant } from "./support/tenant";

/**
 * Portfolio demo spine: seed scenarios → guided walkthrough → theater.
 *
 * Deliberately thinner than a full write-path suite: Select pickers are flaky
 * under Playwright here (see open question #9). Seed + walkthrough covers the
 * 90-second pitch without those locators.
 */
test("sandbox seed surfaces the demo walkthrough and theater link", async ({ page }) => {
  const tenant = uniqueTenant("walkthrough");
  await signUpAndCreateOrg(page, tenant);

  await page.getByRole("link", { name: "Sandbox" }).click();
  await expect(page.getByRole("heading", { name: "Sandbox" })).toBeVisible();

  await page.getByRole("button", { name: "Run scenarios" }).click();
  await expect(page.getByTestId("guided-walkthrough")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Demo walkthrough")).toBeVisible();

  const openTheater = page.getByRole("link", { name: "Open theater" });
  if (await openTheater.count()) {
    await openTheater.click();
    await expect(page.getByTestId("money-flow-theater")).toBeVisible({ timeout: 30_000 });
  } else {
    // First step can be a designed refusal with no transaction id.
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByRole("link", { name: "Open theater" })).toBeVisible();
    await page.getByRole("link", { name: "Open theater" }).click();
    await expect(page.getByTestId("money-flow-theater")).toBeVisible({ timeout: 30_000 });
  }

  await expect(
    page.getByTestId("integrity-seal").or(page.getByTestId("integrity-seal-loading")),
  ).toBeVisible();
});
