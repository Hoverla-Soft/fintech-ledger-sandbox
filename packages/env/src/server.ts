import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    DATABASE_URL: z.string().min(1),
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.url(),
    // Compared byte-for-byte against the browser's `Origin` header — by Hono's
    // `cors()` middleware and by Better Auth's `trustedOrigins`. An `Origin`
    // header never carries a trailing slash, so a configured
    // `https://app.example.com/` matches nothing: the response comes back with
    // no `Access-Control-Allow-Origin` at all and every browser request fails
    // CORS with no hint as to why. Normalize instead of leaving that landmine.
    CORS_ORIGIN: z.url().transform((origin) => origin.replace(/\/+$/, "")),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  },
  runtimeEnv: process.env,
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  emptyStringAsUndefined: true,
});
