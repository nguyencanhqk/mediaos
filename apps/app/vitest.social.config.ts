import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/**
 * S16-SOCIAL-FE-1 — config coverage RIÊNG cho cụm SOCIAL (`pnpm --filter @mediaos/app test:social-cov`).
 *
 * ┌─ 🔴 VÌ SAO PHẢI LÀ MỘT CONFIG THỨ HAI, KHÔNG PHẢI THÊM VÀO `vitest.config.ts` ───────────────┐
 * │ `coverage.include` là **MỘT** danh sách cho cả config. Gộp `routes/social/**` vào include của  │
 * │ `vitest.config.ts` sẽ đổi luôn mẫu số của cổng `test:chat-cov` đang chạy trên CI — hai cụm     │
 * │ dùng chung một con số, và một WO SOCIAL làm tụt coverage sẽ hiện ra như "cụm chat đỏ".         │
 * └───────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ 🔴 LỖI MÀ CỔNG NÀY SINH RA ĐỂ VÁ (plan finding #10, owner ký 23/09/2026) ───────────────────┐
 * │ `test:chat-cov` CHẠY cả `src/layouts`, nhưng `coverage.include` của nó chỉ là                 │
 * │ `src/components/chat/**` ⇒ nó **KHÔNG ĐO một dòng nào** của `routes/social/**` hay             │
 * │ `layouts/portal/**`. Nhầm phạm vi CHẠY với phạm vi ĐO là cách một WO ship ~2.500 dòng mới mà   │
 * │ không cổng coverage nào chạm tới — cùng họ với `chunk-runner-skipped-unit-spec-family`.        │
 * └───────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ Phạm vi CHẠY (danh sách thư mục trong script `test:social-cov`) và phạm vi ĐO (`include` dưới
 * đây) phải đi cùng nhau: bỏ một thư mục khỏi lượt chạy thì file trong `include` mất nguồn thực thi
 * ⇒ coverage TỤT (đỏ) chứ không phải "không đo". Đổi vế nào cũng phải chạy lại rồi ĐỌC SỐ, đừng đoán.
 *
 * ⚠️ `maxThreads=2` giữ y như `test:chat-cov`: lượt coverage trên `apps/app` hay chết
 * `ERR_IPC_CHANNEL_CLOSED` (tinypool) khi chạy nhiều luồng.
 */
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
      include: [
        "src/routes/social/**/*.{ts,tsx}",
        "src/layouts/portal/**/*.{ts,tsx}",
        "src/hooks/use-feed-realtime.ts",
      ],
      exclude: [
        "src/routes/social/**/*.spec.{ts,tsx}",
        "src/layouts/portal/**/*.spec.{ts,tsx}",
        // Vệ tinh fbpost của S9 — KHÔNG thuộc cụm SOCIAL của WO này (plan §1.2), và nó có đường test
        // riêng. Gộp vào đây làm mẫu số của cổng này nói về hai thứ khác nhau.
        "src/routes/social/SocialRedirectPage.tsx",
        "src/routes/social/open-social.ts",
        // Khung test dùng chung (tiền lệ `chat/call/call-test-doubles.ts`) — công cụ, không phải mã
        // sản phẩm. Tính vào mẫu số sẽ làm con số coverage nói về một thứ khác.
        "src/routes/social/feed/social-test-doubles.tsx",
      ],
      thresholds: { statements: 80, branches: 80, functions: 80, lines: 80 },
    },
  },
});
