import { expect, type Page } from "@playwright/test";

/**
 * Picking an option from a Base UI `Select`, without the race that got the
 * Phase 6c write specs deleted.
 *
 * ## What actually went wrong
 *
 * Not "the control could not be addressed" — every `Select` trigger in this
 * console already carries a hand-written `id` through `fieldControlProps`
 * (`account-type`, `transfer-source`, and so on), so locating the trigger was
 * never the problem.
 *
 * The recorded diagnosis was that the popup "stays mounted after selection" and
 * swallowed the next click. Half right, and the wrong half is the important
 * one. Captured from a real failing run, the DOM after choosing a currency and
 * opening the type picker holds **both** listboxes:
 *
 *     <div role="listbox" data-closed  data-slot="select-content">…USD EUR GBP…</div>
 *     <div role="listbox" data-open    data-slot="select-content">…normal external…</div>
 *
 * Base UI does not unmount a closed popup at all — it marks it `data-closed`
 * and leaves it in the document forever. So the closed popup was not
 * intercepting anything; the *locator* was. `[data-slot="select-content"]`
 * accumulates one match for every select the user has ever opened, which is a
 * strict-mode violation from the second picker onward.
 *
 * That explains the original symptom far better than animation timing did: a
 * spec touching one select passed, a spec touching two did not, and which one
 * "won" depended on incidental ordering.
 *
 * ## Why this cannot flake
 *
 * The locator is narrowed to `[data-open]`, and at most one select popup is
 * open at a time — so it resolves to exactly one element or to none. Both waits
 * are on that state: one popup is open, then no popup is open. Nothing waits on
 * a duration, so there is no fixed number to be wrong on a loaded machine.
 */

/** The single popup that is currently open, if any. Closed ones stay mounted as `data-closed`. */
const OPEN_POPUP = '[data-slot="select-content"][data-open]';

export async function selectOption(
  page: Page,
  triggerId: string,
  optionName: string | RegExp,
): Promise<void> {
  const trigger = page.locator(`#${triggerId}`);

  // A disabled trigger is a real failure worth naming here — the transfer
  // form's destination picker stays disabled until a source is chosen, so
  // clicking it out of order should say so rather than time out on the popup.
  await expect(trigger).toBeEnabled();
  await trigger.click();

  const popup = page.locator(OPEN_POPUP);
  await expect(popup).toBeVisible();
  await popup.getByRole("option", { name: optionName, exact: true }).click();

  // Nothing is open any more. Asserted as a count rather than as "hidden",
  // because the element this matched is about to stop matching entirely —
  // Base UI swaps `data-open` for `data-closed` rather than removing the node.
  await expect(page.locator(OPEN_POPUP)).toHaveCount(0);
}
