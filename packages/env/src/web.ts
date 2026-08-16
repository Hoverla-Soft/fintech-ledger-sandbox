import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  clientPrefix: "VITE_",
  client: {
    VITE_SERVER_URL: z.url(),
  },
  // This package compiles under the Node-targeted base tsconfig, which has no
  // Vite client types — a structural cast supplies the `env` shape Vite
  // injects, matching what `createEnv` accepts for `runtimeEnv`.
  runtimeEnv: (import.meta as unknown as { env: Record<string, string | boolean | undefined> }).env,
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  emptyStringAsUndefined: true,
});
