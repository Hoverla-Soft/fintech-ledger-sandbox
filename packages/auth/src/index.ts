import { createDb } from "@fintech-ledger-sandbox/db";
import * as authSchema from "@fintech-ledger-sandbox/db/schema/auth";
import * as organizationSchema from "@fintech-ledger-sandbox/db/schema/organization";
import { env } from "@fintech-ledger-sandbox/env/server";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins";

const db = createDb();

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: { ...authSchema, ...organizationSchema },
  }),
  trustedOrigins: [env.CORS_ORIGIN],
  emailAndPassword: {
    enabled: true,
  },
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  advanced: {
    defaultCookieAttributes: {
      sameSite: "none",
      secure: true,
      httpOnly: true,
    },
  },
  // Organization plugin — tenancy source of truth (`organization`, `member`,
  // `invitation` + `session.activeOrganizationId`).
  plugins: [organization()],
});
