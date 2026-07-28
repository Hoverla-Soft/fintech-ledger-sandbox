import { CURRENCIES, type Currency, minorUnitExponent } from "@fintech-ledger-sandbox/core";

export type { Currency };
/**
 * The currency allowlist, re-exported for clients of this package.
 *
 * `apps/web` needs two things `packages/api` did not previously expose:
 * an **enumerable** list of currencies (to populate a picker before the user
 * has typed anything) and each one's **minor-unit exponent** (to parse and
 * render an amount at the right scale). Neither is derivable from the wire
 * schemas — `currency` is `z.string()` at every boundary (`contracts/wire.ts`,
 * `routers/transactions.ts`), with validation delegated to the domain's
 * `parseCurrency`.
 *
 * This module exists so the console can reach that data **without taking a
 * direct dependency on `@fintech-ledger-sandbox/core`**. The declared
 * dependency direction is `apps/* → packages/api → packages/core`
 * (`docs/development/architecture.md`), and `apps/web` already consumes this
 * package (`apps/web/src/utils/orpc.ts:1`). Adding `core` to the web app's
 * manifest would have needed an architecture amendment and an ADR to buy
 * exactly what one re-export file provides.
 *
 * Deliberately a *re-export*, not a copy. ADR 0002 exists because a guessed
 * exponent is a silent 100× error — JPY is 0 and BHD is 3, so a hardcoded 2
 * misplaces the decimal point without failing anything. There is one
 * allowlist in this repo and it lives in `packages/core`.
 *
 * Reachable as `@fintech-ledger-sandbox/api/contracts/currencies` through the
 * package's existing `"./*": "./src/*.ts"` subpath export — no manifest change
 * was required.
 */
export { CURRENCIES, minorUnitExponent };
