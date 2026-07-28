import { describe, expect, it, vi } from "vitest";

import {
  completeOperation,
  createMemoryKeyStore,
  createSessionKeyStore,
  type KeyStore,
  newOperation,
  peekOperation,
  startOperation,
} from "./idempotency";

/** A store that records every call, so "was anything written?" is assertable. */
function createSpyStore(): KeyStore & { readonly writes: string[] } {
  const inner = createMemoryKeyStore();
  const writes: string[] = [];
  return {
    writes,
    read: (slot) => inner.read(slot),
    write: (slot, value) => {
      writes.push(slot);
      inner.write(slot, value);
    },
    clear: (slot) => inner.clear(slot),
  };
}

describe("startOperation", () => {
  it("returns a byte-identical key on every call for the same operation", () => {
    const store = createMemoryKeyStore();
    const first = startOperation("transfer", store);
    const second = startOperation("transfer", store);
    const third = startOperation("transfer", store);

    // This is the single property that makes a retry a replay rather than a
    // second posting. ADR 0006:17.
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it("mints exactly once — a repeat call does not write again", () => {
    const store = createSpyStore();
    startOperation("transfer", store);
    startOperation("transfer", store);
    startOperation("transfer", store);

    // Safe to call from an effect React may run more than once.
    expect(store.writes).toHaveLength(1);
  });

  it("survives a reload — a fresh store reading the same persisted slot resumes the key", () => {
    const backing = new Map<string, string>();
    const makeStore = (): KeyStore => ({
      read: (slot) => backing.get(slot) ?? null,
      write: (slot, value) => {
        backing.set(slot, value);
      },
      clear: (slot) => {
        backing.delete(slot);
      },
    });

    const before = startOperation("transfer", makeStore());
    // Simulates the page being reloaded mid-submit: new module instances, new
    // store object, same sessionStorage underneath.
    const after = startOperation("transfer", makeStore());
    expect(after).toBe(before);
  });

  it("keeps a separate key per operation kind, so two open forms cannot clobber each other", () => {
    const store = createMemoryKeyStore();
    const transfer = startOperation("transfer", store);
    const reset = startOperation("sandbox-reset", store);
    const reverse = startOperation("reverse:abc-123", store);

    expect(new Set([transfer, reset, reverse]).size).toBe(3);
    // And each stays stable independently.
    expect(startOperation("transfer", store)).toBe(transfer);
    expect(startOperation("sandbox-reset", store)).toBe(reset);
  });

  it("scopes a reversal key to the transaction being reversed", () => {
    const store = createMemoryKeyStore();
    const first = startOperation("reverse:txn-1", store);
    const second = startOperation("reverse:txn-2", store);
    expect(first).not.toBe(second);
  });

  it("mints a key well inside the server's 200-character limit", () => {
    const store = createMemoryKeyStore();
    const key = startOperation("transfer", store);
    expect(key.length).toBeGreaterThan(0);
    expect(key.length).toBeLessThanOrEqual(200);
  });
});

describe("newOperation", () => {
  it("replaces the held key with a different one", () => {
    const store = createMemoryKeyStore();
    const original = startOperation("transfer", store);
    const replacement = newOperation("transfer", store);

    expect(replacement).not.toBe(original);
    // And the replacement is now the stable key for subsequent calls.
    expect(startOperation("transfer", store)).toBe(replacement);
  });
});

describe("completeOperation", () => {
  it("releases the slot so the next operation mints fresh", () => {
    const store = createMemoryKeyStore();
    const first = startOperation("transfer", store);
    completeOperation("transfer", store);

    expect(peekOperation("transfer", store)).toBeNull();
    expect(startOperation("transfer", store)).not.toBe(first);
  });

  it("does not disturb another kind's key", () => {
    const store = createMemoryKeyStore();
    const reset = startOperation("sandbox-reset", store);
    startOperation("transfer", store);
    completeOperation("transfer", store);

    expect(peekOperation("sandbox-reset", store)).toBe(reset);
  });
});

describe("peekOperation", () => {
  it("reads without minting", () => {
    const store = createSpyStore();
    expect(peekOperation("transfer", store)).toBeNull();
    // The dangerous version of this function would mint on a miss, so that
    // merely rendering a page consumed a key.
    expect(store.writes).toHaveLength(0);
  });
});

describe("module import is inert", () => {
  it("performs no storage write and mints nothing at import time", async () => {
    // A key minted at module scope would be shared by every operation in the
    // tab and would outlive the operation it was meant for. This asserts the
    // module cannot do that: evaluating it touches sessionStorage zero times
    // and calls randomUUID zero times.
    //
    // `resetModules` is load-bearing. Without it the static import at the top
    // of this file has already evaluated the module, `await import` returns
    // the cache, nothing re-executes, and the assertions below pass no matter
    // what the module body does.
    vi.resetModules();

    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const getItem = vi.spyOn(Storage.prototype, "getItem");
    const randomUUID = vi.spyOn(globalThis.crypto, "randomUUID");

    const reimported = await import("./idempotency");

    expect(setItem).not.toHaveBeenCalled();
    expect(getItem).not.toHaveBeenCalled();
    expect(randomUUID).not.toHaveBeenCalled();

    // Guards the guard: proves the re-import actually evaluated a live module
    // rather than silently resolving to nothing, so the three assertions above
    // cannot pass vacuously.
    expect(typeof reimported.startOperation).toBe("function");
    reimported.startOperation("transfer", createMemoryKeyStore());
    expect(randomUUID).toHaveBeenCalledTimes(1);

    setItem.mockRestore();
    getItem.mockRestore();
    randomUUID.mockRestore();
  });
});

describe("createSessionKeyStore", () => {
  it("round-trips through the real sessionStorage happy-dom provides", () => {
    const store = createSessionKeyStore();
    const key = startOperation("transfer", store);
    expect(peekOperation("transfer", store)).toBe(key);
    completeOperation("transfer", store);
    expect(peekOperation("transfer", store)).toBeNull();
  });

  it("falls back to memory instead of throwing when sessionStorage is unavailable", () => {
    // Safari's private mode historically threw on write. Losing replay
    // protection is bad; a console that cannot post at all is worse.
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });

    const store = createSessionKeyStore();
    expect(() => startOperation("transfer", store)).not.toThrow();
    const key = startOperation("transfer", store);
    expect(key.length).toBeGreaterThan(0);
    // Still stable within the session, just not across a reload.
    expect(startOperation("transfer", store)).toBe(key);

    // And two independent callers on the fallback path must agree. A fresh
    // memory map per call would give them different keys for the same
    // operation — the exact double-post this module prevents, reintroduced by
    // the safety net.
    const secondCaller = createSessionKeyStore();
    expect(startOperation("transfer", secondCaller)).toBe(key);

    completeOperation("transfer", store);
    setItem.mockRestore();
  });
});
