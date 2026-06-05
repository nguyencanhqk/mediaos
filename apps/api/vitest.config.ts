import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

// SWC giữ decorator metadata cho DI của Nest trong test (esbuild của Vitest không emit metadata).
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    root: ".",
    include: ["src/**/*.spec.ts", "test/**/*.e2e-spec.ts"],
  },
  plugins: [swc.vite()],
});
