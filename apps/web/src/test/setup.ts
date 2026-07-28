import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

/**
 * Suite-wide setup for the console.
 *
 * `@testing-library/jest-dom/vitest` registers the DOM matchers
 * (`toBeInTheDocument`, `toBeDisabled`, …) and their types. `toBeDisabled` in
 * particular is what 5c/5d assert against — "submit is disabled in flight" is
 * a stated frontend requirement (`docs/product/requirements/ledger.md:75-76`),
 * not a nicety.
 *
 * `cleanup` unmounts anything rendered by the previous test. Testing Library
 * auto-cleans only when a global `afterEach` exists, and this suite runs
 * without Vitest globals (every helper is imported explicitly, matching
 * `packages/core` and `packages/api`), so it is registered by hand. Without
 * it, a second `render` in the same file finds two matching elements and
 * queries fail with a confusing "found multiple elements" rather than the real
 * assertion.
 */
afterEach(() => {
  cleanup();
});
