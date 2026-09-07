import { defineConfig } from "vitest/config";
import { fileURLToPath } from "url";

export default defineConfig({
  test: {
    // The pure libs (money, split, balances, simplify) are the whole point of
    // testing here. They have no DOM and no Supabase, so the default node
    // environment is all they need.
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
