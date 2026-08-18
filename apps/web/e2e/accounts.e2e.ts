import { expect, test } from "@playwright/test";

import { selectOption } from "./support/select";
import { signUpAndCreateOrg, uniqueTenant } from "./support/tenant";

/**
 * The accounts screen: what a brand-new org says, and creating the first one.
 *
 * The creation spec was written in Phase 6c, deleted for flaking, and is back
 * with the actual cause fixed rather than papered over — see
 * `support/select.ts`. The short version: the portalled `Select` popup stayed
 * over the form after a choice and swallowed the next click, so the spec passed
 * or failed depending on animation timing. Nothing here waits on a duration.
 */

test("a new org starts empty and says so, rather than rendering a blank table", async ({
  page,
}) => {
  const tenant = uniqueTenant("empty");
  await signUpAndCreateOrg(page, tenant);

  await page.goto("/accounts");

  // Empty and error are different claims, and on a ledger they mean opposite
  // things — one invites you to create an account, the other means the figures
  // on screen may be nothing at all.
  await expect(page.getByTestId("empty-state")).toBeVisible();
  await expect(page.getByTestId("error-state")).not.toBeVisible();
});

test("an admin creates an account through the dialog and sees it in the table", async ({
  page,
}) => {
  const tenant = uniqueTenant("create");
  await signUpAndCreateOrg(page, tenant);

  await page.goto("/accounts");

  // Scoped to the empty state on purpose. The screen renders *two* buttons
  // named "New account" — one in the toolbar, one as the empty state's call to
  // action — so an unscoped lookup is a strict-mode violation rather than a
  // coin flip. This is the one a user with no accounts actually clicks.
  await page.getByTestId("empty-state").getByRole("button", { name: "New account" }).click();

  await page.locator("#account-name").fill("Petty Cash");
  await selectOption(page, "account-currency", "USD");
  await selectOption(page, "account-type", "normal");

  await page.getByRole("button", { name: "Create account" }).click();

  // Creating navigates to the new account. Assert *that* first: the earlier
  // version of this spec checked for a row in the list instead and passed —
  // but only by winning a race against the router leaving the page. It failed
  // as soon as a second account was created in the same run, which is the
  // whole reason this waits on the URL rather than on a cell.
  await page.waitForURL(/\/accounts\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Petty Cash", level: 1 })).toBeVisible();

  // Then go back and confirm it is really in the list — landing on a detail
  // page proves the write returned an id, not that the list can see it.
  await page.goto("/accounts");
  await expect(page.getByRole("cell", { name: "Petty Cash" })).toBeVisible();
  await expect(page.getByTestId("empty-state")).not.toBeVisible();
});
