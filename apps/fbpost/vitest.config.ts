import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Vitest cho fbpost.
 *
 * Chi can mot thu: alias `@/` → `src/`. tsconfig da khai bao no cho TypeScript, nhung Vite/Vitest
 * khong doc `paths` cua tsconfig, nen phai lap lai o day — thieu la moi file dung `@/` deu bao
 * "Cannot find package".
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    // Test chay tren Node: chung kiem tra tang server (SQLite, crypto, middleware), khong phai DOM.
    environment: "node",
    include: ["src/**/*.spec.ts"],
  },
});
