import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SOCIAL_ERR, SOCIAL_POST_TYPE_PAIR_DESYNC } from "./social.errors";

/**
 * S16-SOCIAL-BE-2B-2 · **C-7** — CENSUS "hằng lỗi SOCIAL ném ra mà KHÔNG ca test nào chạm"
 * (khuôn `payroll-error-code-census.unit-spec.ts` · `recruit-error-code-census`).
 *
 * ┌─ LỚP LỖI ĐANG CHẶN, VÀ ĐÍNH CHÍNH TIỀN ĐỀ CỦA PLAN ────────────────────────────────────────────┐
 * │ Plan BE-2B-2 §0.2 ghi «`POLL_CREATE_REQUIRED` của BE-2B-1 ship mà KHÔNG ca int nào chạm», dẫn    │
 * │ chính docblock của hằng đó làm bằng. **ĐO LẠI 24/09/2026: SAI.** BE-2B-1 CÓ viết ca đó —          │
 * │ `social-be2b1-polls-isolation.int-spec.ts` ca **N1** dùng đúng kỹ thuật vai-tuỳ-biến              │
 * │ (`NO_POLL_PAIRS`), có neo dương (cùng user tạo được bài `share`) và đếm bài mồ côi trên DB.       │
 * │ Docblock của hằng là bản CŨ, viết trước khi spec isolation ra đời — đã sửa ở WO này.             │
 * │                                                                                                 │
 * │ Census vẫn cần, chỉ đổi lý do: lớp lỗi ấy **có thật nhưng chưa xảy ra**, và không cổng nào đang   │
 * │ canh nó. Một hằng 403 mọc lên mà không ai đo thì coverage vẫn cao (dòng `throw` nằm trong hàm     │
 * │ được gọi rất nhiều), census 2 tầng vẫn xanh (cặp có mặt trong bảng), route census vẫn xanh        │
 * │ (route có ca HTTP) — ba cổng đắt nhất của module đều mù với đúng câu hỏi này.                    │
 * └────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ VÌ SAO HAI TẦNG BẰNG CHỨNG, KHÔNG PHẢI MỘT ───────────────────────────────────────────────────┐
 * │ ĐO ĐƯỢC 24/09/2026: int-spec BE-1/BE-1B/BE-2A assert bằng **CHUỖI MÃ** (`toContain(             │
 * │ "SOCIAL-ERR-004")`), không bằng tham chiếu hằng. Nhận chuỗi mã làm bằng chứng thì một hằng        │
 * │ "mượn" được ca của hằng ANH EM cùng số: `001` có `POST_NOT_FOUND` + `COMMENT_NOT_FOUND` +         │
 * │ `REPORT_NOT_FOUND`; `010` có `NEWS_MANAGE_REQUIRED` + `MODERATION_FIELD_DENIED`; `007`, `008`     │
 * │ cũng vậy ⇒ bằng chứng theo số là bằng chứng GIẢ cho 8 hằng.                                      │
 * │                                                                                                 │
 * │ Nên: **tầng A** (mạnh, tham chiếu HẰNG) áp cho hằng của WO này + `POLL_CREATE_REQUIRED`;         │
 * │ **tầng B** (yếu, chỉ hỏi "còn ai ném không") áp cho TOÀN BỘ bảng và bắt hằng CHẾT.               │
 * │ Nâng tầng A ra toàn module = sửa cách assert ở 13 int-spec ⇒ nợ, ghi §10 của plan.                │
 * └────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ **Bảng `SOCIAL_POST_TYPE_DENIED` LÀ một throw-site**, không phải khối khai báo: nó nằm trong
 * `social.errors.ts` nhưng `assertCreatablePostType` ném đúng chuỗi lấy từ nó. Strip cả file là làm 4
 * mã 403 theo-loại-bài biến thành "không ném" ⇒ census tự tha đúng nhóm nó cần canh nhất.
 *
 * LỚP BẰNG CHỨNG: quét TĨNH trên chuỗi. KHÔNG chứng minh ca test đúng — chỉ chặn một hằng mọc lên mà
 * không ai đo (khuôn `route-census-runtime-gate`).
 */

const SOCIAL_SRC = path.join(__dirname);
const API_ROOT = path.join(__dirname, "..", "..");
const INTEGRATION = path.join(API_ROOT, "test", "integration");
const FOUNDATION = path.join(API_ROOT, "test", "foundation");

/**
 * TẦNG A — hằng phải có bằng chứng MẠNH: được ném ở `src/social/**` **và** được một spec SOCIAL nhắc
 * tới **bằng tham chiếu hằng** (`SOCIAL_ERR.<KEY>`), không phải bằng chuỗi mã.
 *
 * Phạm vi = 8 hằng của `S16-SOCIAL-BE-2B-2` + `POLL_CREATE_REQUIRED` (BE-2B-1 đã đạt chuẩn này, giữ
 * lại để một lần dọn dẹp "cho gọn" không lặng lẽ hạ chuẩn nó xuống chuỗi mã).
 */
const STRONG_EVIDENCE: readonly string[] = [
  "POLL_CREATE_REQUIRED",
  "IDEA_TRANSITION",
  "IDEA_APPROVE_REQUIRED",
  "IDEA_CREATE_REQUIRED",
  "IDEA_REJECT_NOTE_REQUIRED",
  "KUDOS_BADGE_INVALID",
  "KUDOS_CREATE_REQUIRED",
  "KUDOS_OFFICIAL_DENIED",
  "KUDOS_RECIPIENT_INVALID",
  "KUDOS_RECIPIENT_LIMIT",
  "KUDOS_SELF_RECIPIENT",
  // S16-SOCIAL-BE-1C — 3 hang cua cua dang ky tep. Dat o TANG A (bang chung MANH) ngay tu dau: ca
  // ba deu KHONG co ma `SOCIAL-ERR-0XX`, nen bang chung "theo chuoi ma" von khong ton tai o day —
  // tang B mot minh se tha chung ngay khi co mot `throw` bat ky.
  "FILE_TARGET_POST_DENIED",
  "FILE_TARGET_COMMENT_DENIED",
  "FILE_NOT_OWNED",
];

/**
 * TẦNG B — hằng KHÔNG được ném ở đâu cả. Mỗi dòng phải có LÝ DO ĐO ĐƯỢC, không phải chỗ đổ hằng chưa
 * có test. Cổng hai chiều: nối dây một hằng ở đây mà quên gỡ tên ⇒ ĐỎ.
 */
const NEVER_THROWN: readonly string[] = [
  // `SOCIAL-ERR-009`: mention ngoài audience bị bỏ IM LẶNG, request vẫn 201 và danh sách bị bỏ trả ở
  // `data.droppedMentions[]` (SPEC-16 §12 ghi thẳng). Hằng giữ chỗ, CÓ CHỦ ĐÍCH không bao giờ ném.
  "MENTION_DROPPED_NOT_AN_ERROR",
  // `SOCIAL-ERR-008` nhánh CHẾT — đo 24/09/2026: BE-2A đã MỞ `audience='group'`, nên nhánh "chưa khả
  // dụng" bị gỡ khỏi `src/social` mà hằng còn lại. Dọn nó là việc của WO khác (plan §10 ghi nợ này:
  // BE-2B-2 chạm `superRefine` nhưng KHÔNG gộp việc dọn `SOCIAL-ERR-008`). Census giữ nó HIỆN HÌNH
  // thay vì để nó ngủ trong bảng.
  "AUDIENCE_GROUP_NOT_AVAILABLE",
];

/** Bỏ comment TRƯỚC khi quét: docblock nhắc tên hằng KHÔNG phải bằng chứng (`vitest-exclude-selfcheck-reads-comments`). */
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const walk = (dir: string): string[] =>
  fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));

const readAll = (dir: string, match: (name: string) => boolean): string =>
  walk(dir)
    .filter((p) => match(path.basename(p)))
    .map((p) => stripComments(fs.readFileSync(p, "utf8")))
    .join("\n");

describe("S16-SOCIAL-BE-2B-2 · C-7 · census hằng lỗi SOCIAL", () => {
  /** Nguồn NÉM: mọi file `src/social/**` trừ spec, trừ ĐÚNG khối khai báo `SOCIAL_ERR = {…}`. */
  const throwSrc = (() => {
    const impl = readAll(
      SOCIAL_SRC,
      (n) => n.endsWith(".ts") && !n.endsWith(".spec.ts") && n !== "social.errors.ts",
    );
    const errorsFile = stripComments(
      fs.readFileSync(path.join(SOCIAL_SRC, "social.errors.ts"), "utf8"),
    ).replace(/export const SOCIAL_ERR = \{[\s\S]*?\n\} as const;/, "");
    // Cổng tự-kiểm: strip phải THẬT SỰ cắt được khối đó, nếu không census tha MỌI hằng (xanh rỗng).
    expect(
      errorsFile.includes("POST_NOT_FOUND:"),
      "regex strip khối SOCIAL_ERR đã KHÔNG khớp — census sẽ tha mọi hằng",
    ).toBe(false);
    return `${impl}\n${errorsFile}`;
  })();

  /** Bề mặt TEST của SOCIAL: spec colocated + int-spec + foundation spec mang tên social. */
  const testSurface = [
    readAll(SOCIAL_SRC, (n) => n.endsWith(".spec.ts")),
    readAll(INTEGRATION, (n) => /social/i.test(n) && /\.(int|unit)-spec\.ts$/.test(n)),
    readAll(FOUNDATION, (n) => /social/i.test(n) && /\.(int|unit|e2e)-spec\.ts$/.test(n)),
  ].join("\n");

  const allKeys = Object.keys(SOCIAL_ERR);
  const neverThrown = new Set(NEVER_THROWN);
  const isThrown = (name: string): boolean => throwSrc.includes(`SOCIAL_ERR.${name}`);

  it("neo dương: bề mặt đo KHÔNG rỗng theo cả ba chiều", () => {
    expect(allKeys.length, "bảng SOCIAL_ERR rỗng ⇒ mọi assert dưới đây vacuous").toBeGreaterThan(
      20,
    );
    expect(throwSrc.length, "không đọc được nguồn src/social").toBeGreaterThan(10_000);
    expect(testSurface.length, "không đọc được bề mặt test SOCIAL").toBeGreaterThan(10_000);
    // Neo dương của chính phép đo: một hằng ĐÃ BIẾT có mặt ở cả hai bên, theo cả hai dạng bằng chứng.
    expect(isThrown("POST_NOT_FOUND")).toBe(true);
    expect(testSurface.includes("SOCIAL_ERR.POST_NOT_FOUND")).toBe(true);
    expect(testSurface.includes("SOCIAL-ERR-004")).toBe(true);
  });

  // ══════════════════════════ TẦNG A — bằng chứng MẠNH (tham chiếu hằng) ══════════════════════════

  it.each(STRONG_EVIDENCE.map((n) => [n] as const))(
    "tầng A · %s: được ném ở src/social VÀ được spec nhắc bằng THAM CHIẾU HẰNG",
    (name) => {
      expect(
        Object.prototype.hasOwnProperty.call(SOCIAL_ERR, name),
        `${name} không phải khoá của SOCIAL_ERR — danh sách tầng A trỏ vào hư không`,
      ).toBe(true);
      expect(
        isThrown(name),
        `${name} KHÔNG được ném ở src/social — nối dây nó hoặc gỡ khỏi STRONG_EVIDENCE`,
      ).toBe(true);
      expect(
        testSurface.includes(`SOCIAL_ERR.${name}`),
        `${name} được ném nhưng KHÔNG spec SOCIAL nào assert nó bằng tham chiếu hằng ` +
          `(assert bằng chuỗi mã KHÔNG tính: mã dùng chung cho nhiều hằng ⇒ bằng chứng giả)`,
      ).toBe(true);
    },
  );

  // ══════════════════════ TẦNG B — hằng CHẾT (toàn bảng, bằng chứng yếu) ══════════════════════

  it.each(allKeys.map((n) => [n] as const))(
    "tầng B · %s: còn được ném ở src/social, hoặc nằm trong NEVER_THROWN kèm lý do",
    (name) => {
      const thrown = isThrown(name);
      if (neverThrown.has(name)) {
        expect(
          thrown,
          `${name} đã được nối dây ở src/social nhưng vẫn nằm trong NEVER_THROWN — gỡ khỏi danh sách`,
        ).toBe(false);
        return;
      }
      expect(
        thrown,
        `${name} KHÔNG được ném ở đâu trong src/social — hằng CHẾT. Nối dây, gỡ hằng, hoặc khai ` +
          `NEVER_THROWN kèm lý do đo được`,
      ).toBe(true);
    },
  );

  it("`SOCIAL_POST_TYPE_PAIR_DESYNC` (chân fail-closed, sống NGOÀI `SOCIAL_ERR`) cũng phải được ném", () => {
    expect(throwSrc.includes("SOCIAL_POST_TYPE_PAIR_DESYNC")).toBe(true);
    expect(SOCIAL_POST_TYPE_PAIR_DESYNC.trim().length).toBeGreaterThan(0);
  });

  it("hai danh sách tha/ghim giữ ĐÚNG những gì chúng khai, và KHÔNG phình ra", () => {
    for (const name of NEVER_THROWN) {
      expect(
        Object.prototype.hasOwnProperty.call(SOCIAL_ERR, name),
        `${name} không phải khoá của SOCIAL_ERR — danh sách tha trỏ vào hư không`,
      ).toBe(true);
    }
    // Danh sách tha phình ra là dấu hiệu census bị vô hiệu hoá dần. Ngưỡng đặt sát số ĐO ĐƯỢC
    // (2 hằng, 24/09/2026) — thêm cái thứ ba là một quyết định phải giải trình, không phải thói quen.
    expect(
      NEVER_THROWN.length,
      "NEVER_THROWN phình ra ⇒ census đang bị tha dần",
    ).toBeLessThanOrEqual(2);
    // Không hằng nào vừa "phải có bằng chứng mạnh" vừa "không bao giờ ném".
    expect(STRONG_EVIDENCE.filter((n) => neverThrown.has(n))).toEqual([]);
  });
});
