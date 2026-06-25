import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Workspace packages: resolve to compiled CJS dist so Vite/Vitest can load
      // them without needing to transpile each package's TypeScript source.
      "@mediaos/contracts": path.resolve(__dirname, "../../packages/contracts/dist/cjs/index.js"),
      "@mediaos/ui": path.resolve(__dirname, "../../packages/ui/dist/cjs/index.js"),
      "@mediaos/web-core": path.resolve(__dirname, "../../packages/web-core/dist/cjs/index.js"),
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    include: ["src/**/*.spec.{ts,tsx}"],
  },
});
