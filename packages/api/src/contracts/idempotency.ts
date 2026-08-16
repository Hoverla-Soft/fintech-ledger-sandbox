import { z } from "zod";

/**
 * The prefix the server reserves for keys it derives itself.
 *
 * `approvals.approve` posts under `approve:<pendingId>` so that one pending
 * transfer can yield at most one transaction — the guarantee lives in
 * `UNIQUE (org_id, key)` rather than in a status check two concurrent callers
 * can both pass.
 */
export const SERVER_KEY_PREFIX = "approve:";

/**
 * The idempotency key accepted from a caller on any write.
 *
 * ## Why the prefix is refused rather than merely documented
 *
 * A reservation is decided by `(org_id, key)` plus a request hash: same key and
 * same hash replays, **same key and a different hash is a permanent
 * `IdempotencyConflict`** (`packages/db/src/posting/reserve-key.ts`). Nothing
 * ever deletes a key, so that conflict never clears.
 *
 * That turns a server-derived key into an attack surface the moment a caller
 * can spell it. `approvals.listPending` returns pending ids to any admin, so
 * without this refusal an admin could post an ordinary transfer under the key
 * `approve:<someone else's pendingId>` and permanently prevent that transfer
 * from ever being approved — a denial of approval that needs no race, no
 * special timing, and leaves the victim staring at `idempotency_conflict` on a
 * button that will never work again.
 *
 * Reserving the namespace closes it for every write at once. It is enforced
 * here, in the shared schema, rather than in each router: the six call sites
 * that take an idempotency key all route through this, so a seventh added later
 * inherits the protection instead of reopening the hole.
 */
export const idempotencyKeySchema = z
  .string()
  .min(1)
  .max(200)
  .refine((key) => !key.startsWith(SERVER_KEY_PREFIX), {
    message: `An idempotency key may not start with "${SERVER_KEY_PREFIX}" — that namespace is reserved for keys the server derives.`,
  });
