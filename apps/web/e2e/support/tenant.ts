import { expect, type Page } from "@playwright/test";

/**
 * Sign-up and org creation, driven through the real UI.
 *
 * ## Why this does not forge a session
 *
 * Seeding a user directly and writing a Better Auth cookie would be faster and
 * markedly more brittle — it would pin the suite to Better Auth's session
 * encoding, and it would skip the `/login → /organization → console` routing
 * that `_auth/route.tsx` implements and `ADR 0009` reasons about. That routing
 * is one of the behaviours most worth testing: a session with no active
 * organization is a *normal* state, not an error, and the console is required
 * to send that user to org creation rather than to an error page.
 *
 * ## Why every caller gets a unique tenant
 *
 * There is no database reset between spec files. Isolation comes from each
 * file owning a fresh org, which keeps files order-independent, lets the suite
 * run twice against the same database, and matches how the API's integration
 * suites already work.
 */

export interface Tenant {
  readonly email: string;
  readonly password: string;
  readonly orgName: string;
}

/**
 * A tenant identity nothing else will collide with.
 *
 * `label` names the spec so a row left in the dev database after a run is
 * traceable to the test that made it, rather than being anonymous debris.
 */
export function uniqueTenant(label: string): Tenant {
  const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    email: `e2e-${label}-${stamp}@example.test`,
    password: "correct-horse-battery-staple",
    orgName: `E2E ${label} ${stamp}`,
  };
}

/**
 * Signs up, creates an organization, and leaves the browser on the console.
 *
 * Asserts the intermediate redirect rather than merely waiting it out: landing
 * on `/organization` after sign-up is required behaviour, so a change that
 * dropped the user somewhere else should fail here loudly instead of being
 * absorbed by a `waitForURL` on the final destination.
 */
export async function signUpAndCreateOrg(page: Page, tenant: Tenant): Promise<void> {
  await page.goto("/login");

  // The login route renders sign-up first; sign-in is behind a toggle.
  await page.getByLabel("Name").fill(tenant.orgName);
  await page.getByLabel("Email").fill(tenant.email);
  await page.getByLabel("Password").fill(tenant.password);
  await page.getByRole("button", { name: "Sign Up" }).click();

  // A brand-new user has a session but no active organization, so the tenant
  // gate must route to org creation — not to an error, and not to the console.
  await page.waitForURL("**/organization", { timeout: 30_000 });

  await page.getByLabel("New organization name").fill(tenant.orgName);
  await page.getByRole("button", { name: "Create organization" }).click();

  // The org becomes active, so the nav for org-scoped screens appears.
  await expect(page.getByRole("link", { name: "Accounts" })).toBeVisible({ timeout: 30_000 });
}
