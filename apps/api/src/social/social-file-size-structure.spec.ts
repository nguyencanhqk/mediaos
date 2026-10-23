import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * S16-SOCIAL-POSTSSPLIT-1 — TRẦN 800 DÒNG cho mọi tệp `.ts` của `src/social/` (CLAUDE.md §5 «File»).
 *
 * ┌─ VÌ SAO CẦN CA NÀY ────────────────────────────────────────────────────────────────────────────┐
 * │ `social-posts.service.ts` vượt trần từ BE-2D (904 dòng) và sống ở đó qua nhiều WO vì KHÔNG cổng │
 * │ nào ép trần — mỗi lượt sửa thêm vài dòng, mỗi reviewer thấy diff nhỏ. Tệp càng dài thì docblock │
 * │ bất biến (thứ tự ghi · NGOÀI tx · cổng tầng 2) càng xa chỗ dùng, và lượt sửa sau càng dễ đặt    │
 * │ nhầm một lời gọi vào TRONG `withTenant`.                                                        │
 * │ Ca này đếm theo DÒNG VẬT LÝ (không bỏ comment): trần nói về độ dài người phải đọc, và docblock   │
 * │ của module này là một phần của hợp đồng chứ không phải phần thừa.                               │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Phạm vi = mọi tệp `.ts` PHẲNG trong `src/social/` (kể cả spec) — cùng quy ước quét không đệ quy với
 * census 2 tầng; neo `scanned` chặn xanh-rỗng khi thư mục bị dời.
 */

const SOCIAL_DIR = __dirname;
const MAX_LINES = 800;

function lineCount(text: string): number {
  const body = text.endsWith("\n") ? text.slice(0, -1) : text;
  return body.split("\n").length;
}

describe("S16-SOCIAL-POSTSSPLIT-1 · trần dòng của module SOCIAL", () => {
  it("neo tự-kiểm: đếm dòng khớp `wc -l` (không tính dòng rỗng cuối do xuống dòng kết tệp)", () => {
    expect(lineCount("a\nb\n")).toBe(2);
    expect(lineCount("a\nb")).toBe(2);
    expect(lineCount("a\n\n")).toBe(2);
  });

  it(`mọi tệp .ts phẳng của src/social ≤ ${MAX_LINES} dòng`, () => {
    const files = readdirSync(SOCIAL_DIR).filter((f) => f.endsWith(".ts"));
    expect(
      files.length,
      "bộ quét KHÔNG đệ quy — có tệp nào bị dời vào thư mục con?",
    ).toBeGreaterThan(40);

    const over = files
      .map((f) => ({ f, n: lineCount(readFileSync(join(SOCIAL_DIR, f), "utf8")) }))
      .filter(({ n }) => n > MAX_LINES)
      .map(({ f, n }) => `${f}: ${n} dòng`);
    expect(over, `tách tệp theo trách nhiệm — trần ${MAX_LINES} dòng (CLAUDE.md §5)`).toEqual([]);
  });
});
