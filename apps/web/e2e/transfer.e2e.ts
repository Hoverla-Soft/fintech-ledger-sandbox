import { expect, test } from "@playwright/test";

import { createAccountViaUi } from "./support/accounts";
import { selectOption } from "./support/select";
import { signUpAndCreateOrg, uniqueTenant } from "./support/tenant";

/**
 * The money path, in a real browser: post a transfer, then correct it by
 * reversal.
 *
 * This is the flow Phase 6c wrote, deleted for flaking, and recorded as open
 * question #9(a). It is back because the cause is understood and fixed rather
 * than retried around — see `support/select.ts`.
 *
 * One spec, not two. A reversal needs a transaction to reverse, and splitting
 * them would mean either a second full sign-up plus transfer as setup, or a
 * shared fixture that makes the files order-dependent — which the suite's whole
 * isolation-by-tenancy design avoids.
 */

test("an admin posts a transfer and then reverses it", async ({ page }) => {
  const tenant = uniqueTenant("transfer");
  await signUpAndCreateOrg(page, tenant);

  // `external` funds the sandbox and may go negative; `normal` may not, so the
  // direction below is the only one that works from a standing start.
  await createAccountViaUi(page, { name: "Funding", currency: "USD", type: "external" });
  await createAccountViaUi(page, { name: "Wallet", currency: "USD", type: "normal" });

  await page.goto("/transfer");

  // Option labels carry the balance (`Funding — 0.00 USD`), so these match on
  // the name prefix rather than the whole string — the balance is exactly the
  // part that changes between runs.
  await selectOption(page, "transfer-source", /^Funding/);
  await selectOption(page, "transfer-destination", /^Wallet/);
  await page.locator("#transfer-amount").fill("50.00");

  // Two stages by design: review states the direction in words before anything
  // is posted, because a transfer cannot be edited afterwards.
  await page.getByRole("button", { name: "Review transfer" }).click();
  await page.getByRole("button", { name: "Post transfer" }).click();

  // Posting navigates to the transaction it created. Landing here is the proof
  // that the write returned an id, not merely that the form was submitted.
  await page.waitForURL(/\/transactions\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  const originalId = new URL(page.url()).pathname.split("/").pop() ?? "";
  expect(originalId).toHaveLength(36);

  await page.getByRole("button", { name: "Reverse" }).click();

  // A typed confirmation, not just a second click: reversal posts a real
  // correcting transaction and cannot itself be undone by editing anything.
  await page.locator("#reverse-confirm").fill("REVERSE");
  await page.getByRole("button", { name: "Post reversal" }).click();

  // A reversal is a *new* transaction, not an edit — history is append-only —
  // so the console lands on a different id. Waiting for "some transaction page"
  // would be satisfied by never having navigated at all.
  await page.waitForURL(
    (url) =>
      /\/transactions\/[0-9a-f-]{36}$/.test(url.pathname) && !url.pathname.endsWith(originalId),
    { timeout: 30_000 },
  );

  await expect(page.getByText("reversal", { exact: true })).toBeVisible();

  // Linked back to the exact transaction it corrects. Asserting the href rather
  // than the link text is what makes this about the *pairing* — any reversal of
  // anything would satisfy a text-only check.
  await expect(page.getByRole("link", { name: "an earlier transaction" })).toHaveAttribute(
    "href",
    `/transactions/${originalId}`,
  );

  // And it is a genuine mirror: the transfer debited Wallet, this credits it.
  // That opposition is what makes the pair net to zero.
  await expect(page.getByRole("row", { name: /Wallet/ })).toContainText("50.00 USD");
});
