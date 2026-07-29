import type { NameCursor, TimeCursor } from "@fintech-ledger-sandbox/db/repositories";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

/**
 * Opaque pagination cursors.
 *
 * `packages/db` paginates on a composite `(sort key, id)` index — `(created_at,
 * id)` for transactions and the audit log, `(name, id)` for accounts and
 * reconciliation. Exposing those pairs on the wire would publish the
 * tiebreaker as API surface, making a later sort-key change breaking for every
 * client; one opaque token keeps the ordering an implementation detail.
 *
 * Base64url, not base64: these end up in query strings, where `+` and `/` need
 * escaping.
 *
 * Deliberately **not** signed or encrypted. The payload is a sort key and an id
 * the caller just received, and every query it feeds is `org_id`-filtered
 * independently — a forged cursor cannot page into another tenant. It buys
 * opacity of the *format*, not confidentiality.
 */

/**
 * Bound on an inbound cursor token, so a malformed page request cannot hand
 * `JSON.parse` an unbounded string.
 *
 * The largest real cursor is a name cursor: an account name is capped at 120
 * characters, so the encoded token tops out around 230. The ceiling is
 * generous and still finite.
 */
export const MAX_CURSOR_LENGTH = 512;

export const cursorSchema = z.string().min(1).max(MAX_CURSOR_LENGTH);

/**
 * The largest page a caller may *ask* for.
 *
 * Declared here as well as in `packages/db` — deliberately not shared. They
 * enforce different things: this one rejects an unreasonable request at the
 * contract boundary with a `400`, so a caller asking for 10_000 is told so,
 * while the repository's own clamp is an unconditional server-side ceiling that
 * holds no matter which caller reaches it, including internal ones that never
 * pass through a schema.
 */
export const MAX_PAGE_SIZE = 200;

/**
 * The paging half of a list procedure's input, spread into its `z.object`.
 *
 * Shared so all five paginated procedures accept byte-identical paging input.
 * Five hand-written copies would drift, and a procedure whose `limit` ceiling
 * or `cursor` length differed from the others would fail requests the console
 * builds uniformly.
 */
export const pageInputShape = {
  limit: z.int().min(1).max(MAX_PAGE_SIZE).optional(),
  cursor: cursorSchema.optional(),
} as const;

/** A decoded cursor, sort key still in its wire string form. */
export interface Cursor {
  readonly key: string;
  readonly id: string;
}

/** The encoded payload. Short keys because this is a token, not a document. */
interface EncodedCursor {
  /** The sort key: an ISO-8601 timestamp, or an account name. */
  readonly k: string;
  readonly i: string;
}

export function encodeCursor(cursor: Cursor): string {
  const payload: EncodedCursor = { k: cursor.key, i: cursor.id };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

/**
 * Decodes a token back into its key/id pair.
 *
 * Returns `null` rather than throwing for every malformed case: the input is
 * caller-supplied, so it earns a `400` from the router, and a raw
 * `SyntaxError` escaping would surface as a 500 for a plainly bad request.
 */
export function decodeCursor(token: string): Cursor | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }

  const { k, i } = parsed as Partial<EncodedCursor>;
  if (typeof k !== "string" || typeof i !== "string" || k.length === 0 || i.length === 0) {
    return null;
  }

  return { key: k, id: i };
}

export function encodeTimeCursor(cursor: TimeCursor): string {
  return encodeCursor({ key: cursor.createdAt.toISOString(), id: cursor.id });
}

/**
 * Decodes a `(created_at, id)` cursor.
 *
 * The `Number.isNaN(getTime())` check matters: `new Date("nonsense")` yields an
 * Invalid Date rather than throwing, and an Invalid Date passed into a Drizzle
 * comparison would become `NULL` in SQL, silently matching no rows and
 * returning an empty page instead of an error.
 */
export function decodeTimeCursor(token: string): TimeCursor | null {
  const cursor = decodeCursor(token);
  if (cursor === null) {
    return null;
  }

  const createdAt = new Date(cursor.key);
  if (Number.isNaN(createdAt.getTime())) {
    return null;
  }

  return { createdAt, id: cursor.id };
}

export function encodeNameCursor(cursor: NameCursor): string {
  return encodeCursor({ key: cursor.name, id: cursor.id });
}

/**
 * Decodes a `(name, id)` cursor.
 *
 * No validation beyond `decodeCursor`'s: a name is any non-empty string, and
 * one that matches no row simply yields an empty page — the correct answer for
 * "everything after a name that isn't there", not a bad request.
 */
export function decodeNameCursor(token: string): NameCursor | null {
  const cursor = decodeCursor(token);
  return cursor === null ? null : { name: cursor.key, id: cursor.id };
}

/**
 * The `400` a malformed cursor earns.
 *
 * One definition rather than one per procedure: five paginated procedures owe
 * the caller the *same* response for the same mistake, and the console keys its
 * "that page link expired, here is page one" recovery off `reason ===
 * "invalid_cursor"` — so a procedure that spelled it differently would silently
 * lose that recovery and render an empty list instead. An empty list is the
 * worst possible answer here: it tells someone their ledger is empty when it is
 * not.
 */
function invalidCursor(): ORPCError<"BAD_REQUEST", { reason: string }> {
  return new ORPCError("BAD_REQUEST", {
    message: "Malformed pagination cursor.",
    data: { reason: "invalid_cursor" },
  });
}

/**
 * Decodes an optional inbound `(created_at, id)` cursor, throwing the shared
 * `400` if it is present but unusable.
 *
 * Decoding *before* the query is the point: it keeps an Invalid Date out of
 * Drizzle, where it would become SQL `NULL` and return an empty page rather
 * than an error.
 */
export function decodeTimeCursorOrThrow(token: string | undefined): TimeCursor | undefined {
  if (token === undefined) {
    return undefined;
  }
  const decoded = decodeTimeCursor(token);
  if (decoded === null) {
    throw invalidCursor();
  }
  return decoded;
}

/** Decodes an optional inbound `(name, id)` cursor, throwing the shared `400` if it is present but unusable. */
export function decodeNameCursorOrThrow(token: string | undefined): NameCursor | undefined {
  if (token === undefined) {
    return undefined;
  }
  const decoded = decodeNameCursor(token);
  if (decoded === null) {
    throw invalidCursor();
  }
  return decoded;
}
