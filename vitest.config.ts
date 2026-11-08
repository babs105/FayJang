import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Tests unitaires de la logique pure (src/lib) : calcul des soldes, tranches, libellés.
// Ils tournent sans Supabase ni navigateur.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { include: ["src/**/*.test.ts"], environment: "node" },
});
