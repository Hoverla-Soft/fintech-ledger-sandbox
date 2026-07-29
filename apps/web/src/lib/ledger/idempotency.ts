/**
 * Idempotency keys for the console.
 *
 * ## The failure this prevents
 *
 * `docs/adr/0006-write-endpoint-contract.md:17` — retrying a write under a
 * *fresh* key posts the operation twice. Nothing upstream will catch it: the
 * request hash deliberately excludes `idempotencyKey`, `orgId`, and `actorId`
 * (`packages/api/src/contracts/request-hash.ts`), so two identical payloads
 * under two different keys are two legitimate, distinct transactions as far as
 * the server is concerned. A duplicated payroll run is indistinguishable from
 * a payroll run that genuinely happened twice.
 *
 * ADR 0006 also put the key in the request *body* rather than a header, which
 * means no proxy, gateway, or fetch wrapper can supply or preserve one. The
 * console is the only retry authority in the system.
 *
 * ## The rules that follow
 *
 * 1. A key is minted when an operation *starts* — when a form opens — not when
 *    it is submitted, and never during a render. React 19's StrictMode
 *    double-invokes render; a key minted there is a different key on the
 *    second pass, and the retry that follows is a second posting.
 * 2. A retry of the same intent reuses the key byte-for-byte. That is what
 *    makes it a replay rather than a new operation.
 * 3. A key survives a reload, because a user who refreshes a page mid-submit
 *    must not thereby create a second transaction.
 * 4. Starting over is explicit. `newOperation` exists so that "I want to post
 *    a different transfer" is a deliberate act, never an accident of
 *    remounting.
 *
 * ## Why `sessionStorage`
 *
 * It survives a reload and an in-tab navigation, and dies with the tab.
 * `localStorage` would persist a stale in-flight key for days, so a user
 * returning later — possibly after switching organizations — could resume an
 * operation that no longer means what it did. Retention is deliberately as
 * short as rule 3 allows.
 */

/** The distinct operations that can be in flight at once, each with its own key slot. */
export type OperationKind =
  | "transfer"
  | "exchange"
  | "sandbox-run"
  | "sandbox-reset"
  | `reverse:${string}`;

const STORAGE_PREFIX = "ledger.idempotency.";

/**
 * The storage seam.
 *
 * Injectable so tests drive persistence without a DOM and without leaking
 * state between cases, and so a browser with `sessionStorage` disabled (or a
 * server-side render) degrades instead of throwing.
 */
export interface KeyStore {
  read(slot: string): string | null;
  write(slot: string, value: string): void;
  clear(slot: string): void;
}

/** An in-memory store. The fallback when `sessionStorage` is unavailable, and the default in tests. */
export function createMemoryKeyStore(): KeyStore {
  const entries = new Map<string, string>();
  return {
    read: (slot) => entries.get(slot) ?? null,
    write: (slot, value) => {
      entries.set(slot, value);
    },
    clear: (slot) => {
      entries.delete(slot);
    },
  };
}

/**
 * The one process-wide fallback store.
 *
 * Deliberately a module singleton rather than a fresh map per call. Two
 * callers that each landed on their own memory store would hold *different*
 * keys for the same operation — which is the exact double-post this module
 * exists to prevent, reintroduced by the safety net. Degrading to
 * "keys do not survive a reload" is acceptable; degrading to "two components
 * disagree about the current key" is not.
 */
const fallbackStore = createMemoryKeyStore();

/**
 * The browser store. Falls back to memory rather than throwing when
 * `sessionStorage` is unavailable — Safari's private mode historically threw
 * on write, and losing replay protection is far better than a console that
 * cannot post at all.
 */
export function createSessionKeyStore(): KeyStore {
  try {
    const probe = "__ledger_probe__";
    globalThis.sessionStorage.setItem(probe, "1");
    globalThis.sessionStorage.removeItem(probe);
  } catch {
    return fallbackStore;
  }

  return {
    read: (slot) => globalThis.sessionStorage.getItem(slot),
    write: (slot, value) => {
      globalThis.sessionStorage.setItem(slot, value);
    },
    clear: (slot) => {
      globalThis.sessionStorage.removeItem(slot);
    },
  };
}

function slotFor(kind: OperationKind): string {
  return `${STORAGE_PREFIX}${kind}`;
}

/**
 * A fresh key.
 *
 * `crypto.randomUUID` is 36 characters, comfortably inside the server's
 * `z.string().min(1).max(200)` (`packages/api/src/routers/transactions.ts:173`).
 */
function mint(): string {
  return globalThis.crypto.randomUUID();
}

/**
 * Returns the key for an operation, minting and persisting one only if this
 * operation does not already have it.
 *
 * Idempotent by construction: calling it repeatedly for the same kind returns
 * the same key. That is what makes it safe to call from an effect that React
 * may run more than once, and it is why a submit handler can call it without
 * knowing whether the form has been open for a while or has just remounted.
 */
export function startOperation(kind: OperationKind, store: KeyStore): string {
  const slot = slotFor(kind);
  const existing = store.read(slot);
  if (existing !== null && existing.length > 0) {
    return existing;
  }

  const key = mint();
  store.write(slot, key);
  return key;
}

/**
 * Abandons any key held for this operation and mints a different one.
 *
 * The only sanctioned way to get a new key. Call it when the user explicitly
 * says "this is a different transfer", and after a `409 idempotency_conflict`
 * — which means the key has already been spent on a *different* payload, so
 * reusing it can never succeed.
 *
 * Never call it on a retryable failure. A `422 insufficient_funds` leaves the
 * key alive on purpose: the user fixes the amount and resubmits, and the
 * server treats it as the same operation (`docs/adr/0004-idempotency.md`).
 */
export function newOperation(kind: OperationKind, store: KeyStore): string {
  const key = mint();
  store.write(slotFor(kind), key);
  return key;
}

/** Releases the slot after a terminal outcome — a success, or a conflict that can never be replayed. */
export function completeOperation(kind: OperationKind, store: KeyStore): void {
  store.clear(slotFor(kind));
}

/** The key currently held for this operation, if any. Reads only — never mints. */
export function peekOperation(kind: OperationKind, store: KeyStore): string | null {
  return store.read(slotFor(kind));
}
