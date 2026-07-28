import { expect, test } from "@playwright/test";

import { signUpAndCreateOrg, uniqueTenant } from "./support/tenant";

/**
 * What a brand-new organization's accounts screen says.
 *
 * Deliberately does **not** create an account. Driving the create dialog
 * proved unstable in Phase 6c: the type control is a Base UI `Select` whose
 * listbox stays mounted after selection, and the resulting spec passed on one
 * run and failed on the next. A test that reports different answers for
 * identical code is worse than no test — it teaches people to re-run until
 * green. The write path is covered by the component suite and by the API
 * integration suite; the remaining gap is recorded in `docs/test-coverage.md`
 * rather than papered over with a retry.
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
