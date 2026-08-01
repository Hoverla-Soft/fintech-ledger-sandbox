import { eq } from "drizzle-orm";

import type { Db } from "../index";
import { organization } from "../schema/organization";

export interface OrgSettings {
  readonly requireTransferApproval: boolean;
}

const DEFAULTS: OrgSettings = { requireTransferApproval: false };

function parseMetadata(raw: string | null): Record<string, unknown> {
  if (raw === null || raw.trim() === "") {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export async function getOrgSettings(db: Db, orgId: string): Promise<OrgSettings> {
  const [row] = await db
    .select({ metadata: organization.metadata })
    .from(organization)
    .where(eq(organization.id, orgId));
  if (row === undefined) {
    return DEFAULTS;
  }
  const meta = parseMetadata(row.metadata);
  return {
    requireTransferApproval: meta.requireTransferApproval === true,
  };
}

export async function setRequireTransferApproval(
  db: Db,
  orgId: string,
  requireTransferApproval: boolean,
): Promise<OrgSettings> {
  const [row] = await db
    .select({ metadata: organization.metadata })
    .from(organization)
    .where(eq(organization.id, orgId));
  const meta = parseMetadata(row?.metadata ?? null);
  meta.requireTransferApproval = requireTransferApproval;
  await db
    .update(organization)
    .set({ metadata: JSON.stringify(meta), updatedAt: new Date() })
    .where(eq(organization.id, orgId));
  return { requireTransferApproval };
}
