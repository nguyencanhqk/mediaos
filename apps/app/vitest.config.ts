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
    /**
     * S17-CHAT-UX2-QA-1 — phạm vi đo mở từ `chat/call/**` ra CẢ cụm `chat/**`.
     *
     * Trước WO này `include` chỉ có `call/**`: chạy `--coverage` bằng config kho là đo trên một TẬP
     * CON, nên con số 80% trong done_when của các WO chat nói về một thứ khác với thứ nó định nói.
     *
     * `thresholds` là cổng THẬT — chạy `pnpm --filter @mediaos/app test:chat-cov` mà tụt dưới 80 thì
     * lệnh ĐỎ. Đã nghiệm bằng một lượt đỏ cố ý (hạ sàn giả lên 99 ⇒ đỏ; trả về 80 ⇒ xanh), vì một
     * khoá gõ sai ở đây không báo lỗi mà lặng lẽ xanh vĩnh viễn.
     *
     * ⚠️ CI CHƯA gọi lệnh trên (`Apps — Frontend CI` chạy `pnpm --filter @mediaos/app test`, không có
     * `--coverage`) ⇒ sàn này hôm nay do NGƯỜI/harness ép, chưa phải cổng PR. Nợ đã ghi thành WO
     * `S17-CHAT-UX2-QA-2` trong `harness/backlog.mjs`.
     */
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary"],
      include: ["src/components/chat/**/*.{ts,tsx}"],
      exclude: [
        "src/components/chat/**/*.spec.{ts,tsx}",
        "src/components/chat/call/call-test-doubles.ts",
      ],
      thresholds: { statements: 80, branches: 80, functions: 80, lines: 80 },
    },
  },
});
