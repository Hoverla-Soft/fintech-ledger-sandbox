import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 3001,
  },
  // `vite preview` is what serves the built SPA on Railway: it binds the
  // assigned $PORT on 0.0.0.0, and the Railway-issued domain has to be in
  // `allowedHosts` or Vite's host check rejects every request.
  // ponytail: vite preview is a dev-grade static server (single process, no
  // cache headers, no compression) — fine for a sandbox. Put the SPA behind a
  // CDN or swap in a real static server if it ever takes production traffic.
  preview: {
    port: Number(process.env.PORT) || 3001,
    host: true,
    allowedHosts: [".up.railway.app"],
  },
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [
    tailwindcss(),
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
    }),
    react(),
  ],
});
