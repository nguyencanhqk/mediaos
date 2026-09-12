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
     * S17-CHAT-UX2-QA-2 — sàn này GIỜ LÀ CỔNG PR: `Apps — Frontend CI` có bước riêng
     * `Coverage gate — cụm chat` gọi đúng `test:chat-cov` cho app `app`.
     *
     * ⚠️ ĐỪNG "gọn lại" bằng cách thêm `--coverage` vào script `test`: lượt coverage trên TOÀN suite
     * apps/app chết giữa chừng vì `ERR_IPC_CHANNEL_CLOSED` (tinypool) và không in nổi bảng coverage —
     * lặp 3/3 lượt, kể cả khi hạ `maxThreads`. Chi tiết + số đo: comment ở bước CI đó.
     *
     * ⚠️ `include` dưới đây là phạm vi ĐO; danh sách thư mục trong `test:chat-cov` là phạm vi CHẠY.
     * Hai thứ khác nhau và phải đi cùng nhau: bỏ một thư mục khỏi lượt chạy thì file trong `include`
     * mất nguồn thực thi ⇒ coverage TỤT (đỏ), còn thêm spec nạp file đang 0% thì mẫu số `functions`
     * TĂNG (ACCEPTANCE §4). Đổi vế nào cũng phải chạy lại `test:chat-cov` rồi đọc số, đừng đoán.
     */
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary"],
      include: ["src/components/chat/**/*.{ts,tsx}"],
      exclude: [
        "src/components/chat/**/*.spec.{ts,tsx}",
        "src/components/chat/call/call-test-doubles.ts",
      ],
      thresholds: { statements: 99, branches: 99, functions: 99, lines: 99 },
    },
  },
});
