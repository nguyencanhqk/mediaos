/**
 * S17-CHAT-UX2-FE-2 — `done_when #1`, vế cuối: **tương phản chữ/nền ≥ 4.5:1 ĐO Ở CẢ light LẪN dark**.
 *
 * ══ Vì sao đo trên FILE TOKEN chứ không trên DOM ══
 * jsdom không có engine CSS: render `<div class="bg-bubble-mine">` rồi hỏi `getComputedStyle` chỉ trả
 * lại chuỗi rỗng — Tailwind chưa chạy, biến CSS chưa được phân giải. Một bài test "đo tương phản" dựng
 * trên DOM ở đây sẽ XANH với mọi cặp màu, kể cả chữ trắng trên nền trắng. Nên đo đúng thứ có thật ở
 * thời điểm này: giá trị token trong `theme.css`, tức chính nguồn mà utility sẽ đọc lúc chạy.
 *
 * Đây cũng là lý do hai màu bong bóng là token PHẲNG chứ không phải `primary/12%`: màu trong suốt cho
 * ra tỉ số khác nhau trên mỗi nền nó chồng lên, tức không có một con số nào để khẳng định.
 *
 * ⚠️ Bài test này ĐỎ khi ai đó đổi giá trị token mà không đo lại — đó là mục đích. Nó KHÔNG đỏ khi đổi
 * tên lớp Tailwind; cặp đó do `MessageBubble.spec.tsx` giữ.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Tìm `theme.css` bằng cách ĐI NGƯỢC từ thư mục làm việc, không dùng `import.meta.url`.
 *
 * Vitest transform file spec qua Vite nên `import.meta.url` KHÔNG phải lúc nào cũng là URL `file:` —
 * `readFileSync(new URL(...))` ném "The URL must be of scheme file". Và không dùng một đường dẫn tương
 * đối cứng từ `process.cwd()` được: suite chạy được cả từ `apps/app` (lệnh lẻ) lẫn từ gốc kho (turbo).
 */
const THEME_REL = path.join("packages", "ui", "src", "styles", "theme.css");

function locateTheme(): string {
  let dir = process.cwd();
  for (let i = 0; i < 8; i += 1) {
    const candidate = path.join(dir, THEME_REL);
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Ném chứ không bỏ qua: không tìm thấy file token nghĩa là bài đo này KHÔNG đo được gì — im lặng
  // trả xanh ở đây là đúng loại cổng chết mà nó sinh ra để chặn.
  throw new Error(`Không tìm thấy ${THEME_REL} khi đi ngược từ ${process.cwd()}`);
}

const THEME_CSS = readFileSync(locateTheme(), "utf8");

/** Cắt đúng thân của một khối CSS (`:root {…}` / `.dark {…}`) — dừng ở dấu `}` đầu tiên. */
function block(selector: string): string {
  const start = THEME_CSS.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`Không tìm thấy khối "${selector}" trong theme.css`);
  const end = THEME_CSS.indexOf("\n}", start);
  return THEME_CSS.slice(start, end);
}

function token(selector: string, name: string): string {
  const match = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(block(selector));
  if (!match)
    throw new Error(`Token --${name} vắng mặt (hoặc không phải hex 6) trong "${selector}"`);
  return match[1];
}

/** Độ chói tương đối theo WCAG 2.1 (§ relative luminance). */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const linear = channels.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

/** Tỉ số tương phản WCAG — (L_sáng + 0.05) / (L_tối + 0.05). */
function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Ngưỡng AA cho chữ thường (SPEC-01 §14 · S5-FND-THEME-AA-1). */
const AA = 4.5;

describe("Bong bóng tin v2 · tương phản chữ/nền (CHAT-DEC-024)", () => {
  for (const [mode, selector] of [
    ["light", ":root"],
    ["dark", ".dark"],
  ] as const) {
    describe(mode, () => {
      it("tin CỦA TÔI: --foreground trên --bubble-mine đạt AA", () => {
        const ratio = contrast(token(selector, "foreground"), token(selector, "bubble-mine"));
        expect(ratio).toBeGreaterThanOrEqual(AA);
      });

      it("tin NGƯỜI KHÁC: --foreground trên --surface-2 đạt AA", () => {
        const ratio = contrast(token(selector, "foreground"), token(selector, "surface-2"));
        expect(ratio).toBeGreaterThanOrEqual(AA);
      });

      it("hai nền bong bóng PHÂN BIỆT được với nền khung — nếu không thì 'hai phía' vô nghĩa", () => {
        // Không dùng ngưỡng AA ở đây (đây là nền-trên-nền, không phải chữ): 1.05 đủ để khẳng định hai
        // mặt phẳng KHÔNG trùng màu. Bằng nhau ⇒ bong bóng tàng hình và bố cục hai phía mất tác dụng.
        expect(
          contrast(token(selector, "bubble-mine"), token(selector, "background")),
        ).toBeGreaterThan(1.05);
        expect(
          contrast(token(selector, "surface-2"), token(selector, "background")),
        ).toBeGreaterThan(1.05);
      });
    });
  }

  it("ĐỐI CHỨNG: phép đo THẬT SỰ bắt được một cặp tồi (không xanh-giả)", () => {
    // Không có ca này thì một hàm `contrast()` trả hằng số 21 cũng làm mọi khẳng định trên xanh.
    expect(contrast("#ffffff", "#fefefe")).toBeLessThan(AA);
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 1);
  });

  it("ĐỐI CHỨNG: token vắng mặt thì NÉM, không âm thầm bỏ qua", () => {
    expect(() => token(":root", "bubble-khong-ton-tai")).toThrow();
  });
});
