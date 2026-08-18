import { expect, type Page } from "@playwright/test";

import { selectOption } from "./select";

/**
 * Creating an account through the real dialog, as *setup* for another spec.
 *
 * `accounts.e2e.ts` deliberately does not use this: there, creating an account
 * is the behaviour under test, and a test that calls a helper to do the thing
 * it is testing hides the steps it exists to pin. Here it is scaffolding for
 * the transfer flow, which needs two accounts before it can move anything.
 *
 * Still driven through the UI rather than seeded over the API. A transfer spec
 * whose accounts arrived by a route the console never takes would not be
 * testing the console.
 */
export async function createAccountViaUi(
  page: Page,
  account: { name: string; currency: string; type: "normal" | "external" },
): Promise<void> {
  await page.goto("/accounts");

  // Two buttons share the name "New account" while the org is empty — the
  // toolbar's (`index.tsx:60`) and the empty state's (`index.tsx:145`) — which
  // is a strict-mode violation unscoped. The toolbar's comes first in the DOM
  // and is present in both states, so `.first()` is stable whether or not this
  // is the first account. They open the same dialog either way.
  await page.getByRole("button", { name: "New account" }).first().click();

  await page.locator("#account-name").fill(account.name);
  await selectOption(page, "account-currency", account.currency);
  await selectOption(page, "account-type", account.type);
  await page.getByRole("button", { name: "Create account" }).click();

  // Creating navigates to the new account's detail screen
  // (`create-account-dialog.tsx:75`), so wait for *that*, not for a row in the
  // list. Waiting on the list is a race this suite already lost once: the
  // assertion can pass in the instant before the router leaves, which reads as
  // a pass and then fails the next time the page is a little slower.
  await page.waitForURL(/\/accounts\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: account.name, level: 1 })).toBeVisible();
}
