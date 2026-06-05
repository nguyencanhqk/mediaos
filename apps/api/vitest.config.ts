import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

// SWC giữ decorator metadata cho DI của Nest trong test (esbuild của Vitest không emit metadata).
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    root: ".",
    // *.int-spec.ts = integration (Postgres thật) — tự skip khi không có DATABASE_URL (xem helpers/integration-db).
    include: ["src/**/*.spec.ts", "test/**/*.e2e-spec.ts", "test/**/*.int-spec.ts"],
    // Integration test mở/đóng pool + chạy DDL → nới timeout mặc định.
    testTimeout: 20000,
    hookTimeout: 30000,
  },
  plugins: [swc.vite()],
});
