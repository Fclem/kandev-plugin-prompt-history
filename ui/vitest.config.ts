import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    // Builds ui/bundle.js for the shipped-artifact smoke; esbuild cannot run
    // inside the jsdom environment itself.
    globalSetup: ["src/bundle-build.setup.ts"],
  },
});
