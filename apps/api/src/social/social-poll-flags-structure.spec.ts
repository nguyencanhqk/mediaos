import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * S16-SOCIAL-BE-2B-1 — **nợ (b) của DB-2**, ràng buộc CẤU TRÚC chứ không phải hành vi.
 *
 * ┌─ VÌ SAO KHÔNG CÓ CA RUNTIME NÀO THAY ĐƯỢC FILE NÀY ──────────────────────────────────────────┐
 * │ `db/schema/social.ts:596-600` ra lệnh: `multiple_choice` và `is_anonymous` là BẤT BIẾN sau khi │
 * │ tạo, **«service PHẢI chặn UPDATE»** — đổi giữa chừng làm chốt `feed_poll_votes_single_uq` sai  │
 * │ lệch IM LẶNG (partial index không đọc được bảng khác: hàng phiếu cũ ghi `single_choice=true`   │
 * │ vẫn nằm đó trong khi poll đã thành đa-lựa-chọn, và ngược lại).                                 │
 * │                                                                                               │
 * │ Luật này nói về thứ **KHÔNG ĐƯỢC TỒN TẠI**. Không có request nào gọi ra được một UPDATE mà     │
 * │ không ai viết. Lý lẽ «hôm nay không có route PATCH nên tự động đúng» BỊ CẤM — chính WO này mở  │
 * │ `closeTx`, đường UPDATE ĐẦU TIÊN vào `feed_polls`; người sau chỉ cần thêm một cột vào cùng     │
 * │ câu `.set()` đó là bất biến bay mất, không lỗi, không log.                                     │
 * └───────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Khuôn: `realtime/chat-realtime-structure.spec.ts` (đọc mã nguồn + `stripComments`).
 */

const SOCIAL_DIR = __dirname;

/** Site DUY NHẤT được phép ghi hai cờ bất biến của poll. */
const POLL_FLAG_WRITER = "social-post-types.ts";

/** File chứa cả hai đường đóng poll (`044` tay + job theo hạn). */
const POLL_REPOSITORY = "social-polls.repository.ts";

/**
 * Tập cột mà một câu đóng poll được phép ghi — ĐÓNG.
 *
 * `updated_at` có mặt vì đây là UPDATE thật; `closed_at` **bắt buộc đi cùng** `status` nếu không sẽ
 * vỡ CHECK `chk_feed_polls_closed_pair` (`status='open' OR closed_at IS NOT NULL`) ⇒ 500.
 */
const ALLOWED_CLOSE_COLUMNS_CAMEL = ["status", "closedAt", "updatedAt"] as const;
const ALLOWED_CLOSE_COLUMNS_SNAKE = ["status", "closed_at", "updated_at"] as const;

/** Bỏ comment — luật nói về CODE, không về văn xuôi GIẢI THÍCH luật (chính docblock ở trên sẽ làm spec đỏ oan). */
const stripComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/**
 * Mọi file `.ts` (bỏ spec) ngay trong `src/social/`.
 *
 * ⚠️ PHẲNG, không đệ quy — **cố ý giống census** (`test/foundation/social-two-layer-guard-census
 * .unit-spec.ts:164`): module này quy ước mọi file service nằm phẳng. Một file đặt trong thư mục con
 * sẽ vô hình với CẢ census LẪN spec này; đó là lý do `D17` của plan tồn tại.
 */
function socialSources(): { file: string; text: string }[] {
  return readdirSync(SOCIAL_DIR)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".spec.ts"))
    .map((f) => ({ file: f, text: stripComments(readFileSync(join(SOCIAL_DIR, f), "utf8")) }));
}

/** Thân của mọi literal `{...}` truyền thẳng vào `.values(` / `.set(` trong một file. */
function writeObjectBodies(text: string): string[] {
  const out: string[] = [];
  const re = /\.(?:values|set)\(\s*\{([\s\S]*?)\}\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.push(m[1]);
  return out;
}

/** Tên khoá cấp-một của một thân object literal (`a: 1, b, c: {…}` → `["a","b","c"]`). */
function topLevelKeys(body: string): string[] {
  const keys: string[] = [];
  let depth = 0;
  let atKeyPosition = true;
  let buf = "";
  for (const ch of body) {
    if (ch === "{" || ch === "[" || ch === "(") depth += 1;
    else if (ch === "}" || ch === "]" || ch === ")") depth -= 1;

    if (depth === 0 && ch === ",") {
      atKeyPosition = true;
      buf = "";
      continue;
    }
    if (depth === 0 && ch === ":") {
      if (atKeyPosition) {
        const name = buf.trim();
        if (name) keys.push(name);
      }
      atKeyPosition = false;
      buf = "";
      continue;
    }
    if (atKeyPosition) buf += ch;
  }
  // Khoá viết tắt cuối cùng (`{ status }`) không có dấu `:` theo sau.
  const tail = buf.trim();
  if (atKeyPosition && tail && /^[A-Za-z_$][\w$]*$/.test(tail)) keys.push(tail);
  return keys;
}

describe("Nợ (b) DB-2 — `multiple_choice`/`is_anonymous` BẤT BIẾN sau khi tạo poll", () => {
  it("KHÔNG site nào ngoài `createPollTx` ghi hai cờ đó, và site hợp lệ có ĐÚNG MỘT", () => {
    const flagWriters: string[] = [];
    let legitWriteSites = 0;

    for (const { file, text } of socialSources()) {
      for (const body of writeObjectBodies(text)) {
        const keys = topLevelKeys(body);
        if (!keys.includes("multipleChoice") && !keys.includes("isAnonymous")) continue;
        if (file === POLL_FLAG_WRITER) legitWriteSites += 1;
        else flagWriters.push(file);
      }
    }

    // Vế PHỦ ĐỊNH — cái mà bất biến thật sự cấm.
    expect(flagWriters).toEqual([]);

    // 🔴 NEO DƯƠNG. Nếu không có vế này, spec vẫn XANH khi `createPollTx` biến mất, khi nó đổi tên
    // file, hoặc khi regex `writeObjectBodies` thôi khớp được gì — tức là lưới rỗng trông y hệt lưới
    // đang gác. Đây chính là hình dạng "deny vacuous" mà plan §5 cấm.
    expect(legitWriteSites).toBe(1);
  });

  it("mọi câu đóng poll ghi ĐÚNG tập cột đóng — cấm mapped-write, cả builder LẪN SQL thô", () => {
    const source = socialSources().find((s) => s.file === POLL_REPOSITORY);
    expect(source, `thiếu ${POLL_REPOSITORY}`).toBeDefined();
    const text = (source as { text: string }).text;

    // ── Dạng 1: drizzle builder `.set({ … })` — đường đóng TAY (`044`) ──
    const setBodies = text
      .split(/\.set\(\s*\{/)
      .slice(1)
      .map((chunk) => chunk.split(/\}\s*\)/)[0]);

    for (const body of setBodies) {
      // `toEqual` trên mảng đã sắp xếp: thừa MỘT cột cũng đỏ. Đó là điểm của ca này — drizzle BỎ QUA
      // IM LẶNG khoá không phải cột (`payroll-fsm.ts:37-38`), nên `.set({ multipleChoice })` lọt vào
      // đây sẽ không ném gì lúc chạy; chỉ có spec đọc mã nguồn mới thấy.
      expect([...topLevelKeys(body)].sort()).toEqual([...ALLOWED_CLOSE_COLUMNS_CAMEL].sort());
    }

    // ── Dạng 2: SQL THÔ `UPDATE feed_polls SET … WHERE` — đường đóng của JOB ──
    //
    // 🔴 Ca này ban đầu chỉ gác dạng 1 và giả định cả hai đường đóng đều là builder. Thực tế đường
    // job **phải** là SQL thô: nó set-based, và một vòng lặp per-row sẽ mất
    // `idx_feed_polls_open_deadline`. Nếu để nguyên giả định cũ, nửa đường ghi vào `feed_polls`
    // **không được gác gì cả** — đúng lớp lỗi mà chính spec này sinh ra để chặn.
    const rawSetClauses = [
      ...text.matchAll(/UPDATE\s+feed_polls\s+SET\s+([\s\S]*?)\bWHERE\b/gi),
    ].map((m) => m[1]);

    for (const clause of rawSetClauses) {
      const columns = [...clause.matchAll(/(\w+)\s*=/g)].map((m) => m[1]).sort();
      expect(columns).toEqual([...ALLOWED_CLOSE_COLUMNS_SNAKE].sort());
    }

    // 🔴 NEO DƯƠNG cho CẢ HAI dạng. Không có hai vế này thì một file repository không còn câu ghi
    // nào cũng làm hai vòng lặp trên chạy 0 lần và XANH — lưới rỗng trông y hệt lưới đang gác.
    expect(setBodies.length, "đúng MỘT đường đóng tay (044) dùng builder").toBe(1);
    expect(rawSetClauses.length, "đúng MỘT đường đóng của job dùng SQL thô").toBe(1);
  });
});
