import dotenv from "dotenv";
import { defineConfig } from "drizzle-kit";

dotenv.config({
  path: "../../apps/server/.env",
});

export default defineConfig({
  // The barrel, not the `./src/schema` directory. Pointed at the directory,
  // drizzle-kit loads every `.ts` inside it — including `*.test.ts`, whose
  // `vitest` import its CommonJS transformer cannot `require()`, which broke
  // `pnpm db:generate` outright. `index.ts` re-exports all three schema
  // modules, so this loads exactly the same tables and nothing else.
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL || "",
  },
});
