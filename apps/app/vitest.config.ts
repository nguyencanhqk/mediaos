import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    include: ["src/**/*.spec.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary"],
      include: ["src/components/chat/call/**/*.{ts,tsx}"],
      exclude: [
        "src/components/chat/call/**/*.spec.{ts,tsx}",
        "src/components/chat/call/call-test-doubles.ts",
      ],
    },
  },
});
