import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SOCIAL_ERR } from "./social.errors";

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
  // S16-SOCIAL-BE-3A — 6 hang khong so hoa: hanh dong kem cua `029` + CRUD huy hieu. Deu o TANG A:
  // khong co ma `SOCIAL-ERR-0XX` nen bang chung "theo chuoi ma" khong ton tai.
  "REPORT_ACTION_DENIED",
  "REPORT_ACTION_INVALID_FOR_TARGET",
  "REPORT_ACTION_TARGET_UNAVAILABLE",
  "REPORT_BUSY",
  "KUDOS_BADGE_CODE_TAKEN",
  "KUDOS_BADGE_NOT_FOUND",
  // S16-SOCIAL-BE-3B — 403 `orgUnitId` ngoai pham vi thong ke (052/053). TANG A: khong co ma so.
  "STATS_UNIT_OUT_OF_SCOPE",
  // S16-SOCIAL-BE-3C — 409 khoi phuc bai thuoc nhom da xoa mem (058, D12). TANG A: khong co ma so.
  "RESTORE_GROUP_DELETED",
  // S16-SOCIAL-GROUPERR-1 — 2 sentinel nhom (O1) + 3 chuoi doi VAO bang (D11). `POST_TYPE_PAIR_DESYNC`
  // KHONG o day: chan fail-closed, khong dung duoc qua HTTP khi hai bang khop ⇒ chi tang B + unit.
  "GROUP_NAME_TAKEN",
  "GROUP_MEMBER_NOT_FOUND",
  "CURSOR_INVALID",
  "CURSOR_FILTER_MISMATCH",
  "PIN_NEWS_ONLY",
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

/**
 * TẦNG D (S16-SOCIAL-QA-1) — khoá ĐƯỢC NÉM nhưng không ra tới dây qua HTTP. Mọi khoá được ném KHÁC phải
 * có ca int-spec assert `error.code` bằng hằng mã (`SOCIAL_ERROR_CODES.<KHOÁ>`). Mỗi dòng ở đây phải có
 * lý do ĐO ĐƯỢC; `direct` = tên file spec (cạnh nguồn) có ca gọi THẲNG service cho khoá đó, `null` = không
 * dựng được ca nào khi hai bảng hằng còn khớp.
 */
const HTTP_UNREACHABLE: ReadonlyArray<{ key: string; why: string; direct: string | null }> = [
  {
    key: "REACTION_EMOJI_INVALID",
    why: "schema của thân request từ chối giá trị ngoài bộ cảm xúc TRƯỚC khi vào service ⇒ trên dây là 400 chung; ca gọi thẳng service nằm ở int-spec QA-1 (E-X5)",
    direct: null,
  },
  {
    key: "AUDIENCE_KEY_MISSING",
    why: "schema tạo bài từ chối audience thiếu khoá TRƯỚC khi vào service ⇒ trên dây là 400 chung",
    direct: "social-access.service.spec.ts",
  },
  {
    key: "POST_TYPE_PAIR_DESYNC",
    why: "chân fail-closed: chỉ ném khi hai bảng hằng theo loại bài lệch nhau; hai bảng đang khớp",
    direct: null,
  },
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
    // …và KHÔNG cắt LỐ (plan GROUPERR-1 §6 H1): regex lười chạy tới `} as const;` KẾ TIẾP nếu khối
    // SOCIAL_ERR đổi đuôi (vd `} as const satisfies …;`) ⇒ nuốt hai bảng throw-site bên dưới.
    for (const table of ["SOCIAL_POST_TYPE_DENIED", "SOCIAL_FILE_TARGET_DENIED"]) {
      expect(errorsFile.includes(`export const ${table}`), `strip cắt lố, nuốt mất ${table}`).toBe(
        true,
      );
    }
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

  // (S16-SOCIAL-GROUPERR-1 D11: ca riêng cho `SOCIAL_POST_TYPE_PAIR_DESYNC` đã gỡ — hằng rời được dời
  // VÀO bảng thành `SOCIAL_ERR.POST_TYPE_PAIR_DESYNC`, nên tầng B canh nó như mọi khoá khác.)

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

  // ══════════ TẦNG D (S16-SOCIAL-QA-1) — mỗi khoá được ném có ca HTTP assert theo MÃ ══════════
  //
  // Tầng A chỉ đòi tham chiếu hằng THÔNG ĐIỆP ở bất kỳ spec nào. Một chỗ ném quên bọc `socialError(`
  // vẫn trả đúng thông điệp ⇒ tầng A xanh trong khi `error.code` trên dây đã rơi về mã chung. Tầng D đòi
  // tham chiếu hằng MÃ trong một int-spec — nơi duy nhất `error.code` được đọc từ phản hồi HTTP thật.

  /** CHỈ int-spec (ca chạy qua HTTP) — spec cạnh nguồn và spec `foundation` không tính. */
  const intSurface = readAll(INTEGRATION, (n) => /social/i.test(n) && n.endsWith(".int-spec.ts"));
  const unreachable = new Set(HTTP_UNREACHABLE.map((u) => u.key));
  const tierD = allKeys.filter((n) => !neverThrown.has(n) && !unreachable.has(n));
  const hasCodeCase = (name: string): boolean =>
    new RegExp(`SOCIAL_ERROR_CODES\\.${name}\\b`).test(intSurface);

  it.each(tierD.map((n) => [n] as const))("tầng D · %s: có ca int-spec assert theo MÃ", (name) => {
    expect(
      hasCodeCase(name),
      `${name}: thiếu ca theo MÃ — không int-spec SOCIAL nào assert error.code bằng ` +
        `SOCIAL_ERROR_CODES.${name}. Thêm ca, hoặc khai HTTP_UNREACHABLE kèm lý do đo được`,
    ).toBe(true);
  });

  it("tầng D · neo: bề mặt int-spec không rỗng, 52 khoá phải có ca, danh sách tha KHÔNG phình", () => {
    expect(intSurface.length, "không đọc được int-spec SOCIAL").toBeGreaterThan(10_000);
    expect(hasCodeCase("POST_NOT_FOUND")).toBe(true);
    // Khoá bịa phải KHÔNG khớp — phép dò không được «luôn đúng».
    expect(hasCodeCase("POST_NOT")).toBe(false);
    expect(tierD.length).toBe(52);
    expect(HTTP_UNREACHABLE.length, "HTTP_UNREACHABLE phình ra ⇒ tầng D bị tha dần").toBe(3);
  });

  it.each(HTTP_UNREACHABLE.map((u) => [u.key, u] as const))(
    "tầng D · %s: khai «không ra dây» thì vẫn phải được ném, và có ca gọi thẳng nếu đã khai",
    (name, entry) => {
      expect(
        Object.prototype.hasOwnProperty.call(SOCIAL_ERR, name),
        `${name} không phải khoá của SOCIAL_ERR`,
      ).toBe(true);
      expect(neverThrown.has(name), `${name} nằm ở cả hai danh sách tha`).toBe(false);
      expect(
        isThrown(name),
        `${name} không còn được ném ⇒ thuộc NEVER_THROWN, không thuộc đây`,
      ).toBe(true);
      expect(entry.why.length).toBeGreaterThan(20);
      if (entry.direct !== null) {
        const src = stripComments(fs.readFileSync(path.join(SOCIAL_SRC, entry.direct), "utf8"));
        expect(src.includes(`SOCIAL_ERR.${name}`), `${entry.direct} không còn ca cho ${name}`).toBe(
          true,
        );
      }
    },
  );
});

/**
 * S16-SOCIAL-GROUPERR-1 · **TẦNG C** — mọi lỗi HTTP ném ở `src/social` phải MANG MÃ SOCIAL lên
 * `error.code` (plan §3 C-S + §6 B2).
 *
 * Lớp lỗi đang chặn là FAIL-QUIET: một chỗ `new XxxException(SOCIAL_ERR.K)` quên bọc `socialError(…)`
 * vẫn trả đúng status + đúng thông điệp (mọi int-spec cũ assert theo thông điệp ⇒ XANH), chỉ `error.code`
 * lặng lẽ rơi về mã chung — đúng hiện trạng trước WO này, và FE đọc mã sẽ hiểu sai mà không ai thấy.
 *
 * Quét TĨNH từng file (bỏ comment): mọi `new <X>Exception(` phải có đối số bắt đầu bằng `socialError(`
 * (chịu xuống dòng — prettier bẻ dòng dài). Ngoại lệ là allowlist ĐÓNG: mỗi mục khớp ĐÚNG một chỗ, là lỗi
 * THUẦN chung (không phải lỗi SOCIAL) — một mục trộn nhánh SOCIAL với nhánh chung là lỗ (B2).
 * Bằng chứng runtime nằm ở `social-grouperr1-wire-codes.int-spec.ts` (W1–W13).
 */
describe("S16-SOCIAL-GROUPERR-1 · tầng C · lỗi SOCIAL mang mã lên error.code", () => {
  /** Allowlist ĐÓNG — file + đầu đối số (đã gộp khoảng trắng) + lý do. */
  const GENERIC_THROWS: ReadonlyArray<{ file: string; starts: string; why: string }> = [
    {
      file: "social-access.service.ts",
      starts: 'new ForbiddenException("AUTH-ERR-FORBIDDEN:',
      why: "resolveActor — route không có `denyMessage` riêng: mã AUTH chung (D13)",
    },
    {
      file: "social-access.service.ts",
      starts: 'new ForbiddenException("AUTH-ERR-SCOPE-DENIED:',
      why: "resolveActor — sàn Company, route không có `denyMessage`: nợ S16-SOCIAL-SCOPEDENIEDCODE-1",
    },
    {
      file: "social-files.service.ts",
      starts: 'new NotFoundException("RESOURCE-ERR-NOT-FOUND:',
      why: "055 confirm tệp không tồn tại — lỗi tệp dùng chung, không phải lỗi SOCIAL",
    },
    {
      file: "social-attachments.service.ts",
      starts: "new SocialAttachGateDeniedException(",
      why: "lớp TỰ bọc trong ctor — ghim riêng bởi ca «super(socialError(reason))» bên dưới",
    },
  ];

  /**
   * Controller SOCIAL sống NGOÀI `src/social` (FULL gate silent-failure LOW-2): `057`/`058` phục vụ ở
   * `/recycle-bin/feed-posts`. Hôm nay nó không ném gì — đưa vào tầm quét để một `throw` thêm sau này
   * không vô hình với tầng C.
   */
  const SOCIAL_OUTSIDE_SRC = [
    path.join(API_ROOT, "src", "recycle-bin", "recycle-bin-feed-posts.controller.ts"),
  ];
  const files = [
    ...walk(SOCIAL_SRC).filter(
      (p) =>
        p.endsWith(".ts") && !p.endsWith(".spec.ts") && path.basename(p) !== "social.errors.ts",
    ),
    ...SOCIAL_OUTSIDE_SRC,
  ];
  const NEW_EXCEPTION = /new\s+\w+Exception\(/g;

  const scan = (() => {
    let wrapped = 0;
    const bare: string[] = [];
    const used = new Map<number, number>();
    for (const p of files) {
      const src = stripComments(fs.readFileSync(p, "utf8"));
      for (const m of src.matchAll(NEW_EXCEPTION)) {
        const after = src.slice(m.index + m[0].length, m.index + m[0].length + 200);
        if (/^\s*socialError\(/.test(after)) {
          wrapped += 1;
          continue;
        }
        const site = `${m[0]}${after}`.replace(/\s+/g, " ").replace(/\(\s+/g, "(");
        const hit = GENERIC_THROWS.findIndex(
          (g) => g.file === path.basename(p) && site.startsWith(g.starts),
        );
        if (hit >= 0) used.set(hit, (used.get(hit) ?? 0) + 1);
        else bare.push(`${path.basename(p)}: ${site.slice(0, 110)}`);
      }
    }
    return { wrapped, bare, used };
  })();

  it("mọi `new XxxException(` ở src/social bọc `socialError(…)`, trừ allowlist lỗi THUẦN chung", () => {
    expect(
      scan.bare,
      "chỗ ném KHÔNG bọc socialError ⇒ error.code rơi về mã chung im lặng. Bọc nó, hoặc nếu THẬT SỰ " +
        "không phải lỗi SOCIAL thì khai GENERIC_THROWS kèm lý do",
    ).toEqual([]);
  });

  it("neo dương: đếm được ≥ 95 chỗ đã bọc (đo 29/09/2026: 99) — phép quét KHÔNG rỗng", () => {
    expect(files.length).toBeGreaterThan(20);
    expect(scan.wrapped).toBeGreaterThanOrEqual(95);
  });

  it("allowlist ĐÓNG: ≤ 4 mục, mỗi mục khớp ĐÚNG một chỗ (mục mồ côi hoặc bị tái dùng ⇒ đỏ)", () => {
    expect(GENERIC_THROWS.length).toBeLessThanOrEqual(4);
    GENERIC_THROWS.forEach((g, i) => {
      expect(scan.used.get(i) ?? 0, `${g.file} «${g.starts}» phải khớp đúng 1 chỗ`).toBe(1);
    });
  });

  it("regex `new …Exception(` KHÔNG bị lách: không alias `XxxException as Y`, không lớp con nào ngoài lớp đã ghim", () => {
    // FULL gate silent-failure LOW-3: `import { ForbiddenException as Deny }` hay `class X extends
    // ForbiddenException` (tên không đuôi `Exception`) sẽ ném mà regex tầng C không nhìn thấy.
    for (const p of files) {
      const src = stripComments(fs.readFileSync(p, "utf8"));
      expect(src, `${path.basename(p)}: alias exception làm tầng C mù`).not.toMatch(
        /\w+Exception\s+as\s+\w+/,
      );
      for (const m of src.matchAll(/class\s+(\w+)\s+extends\s+\w*Exception\b/g)) {
        expect(m[1], `${path.basename(p)}: lớp con exception chưa được ghim`).toBe(
          "SocialAttachGateDeniedException",
        );
      }
    }
    expect(fs.existsSync(SOCIAL_OUTSIDE_SRC[0]), "controller 057/058 đã dời chỗ").toBe(true);
  });

  it("`SocialAttachGateDeniedException` TỰ bọc: ctor nhận `SocialErrorMessage` và gọi `super(socialError(reason))`", () => {
    const src = stripComments(
      fs.readFileSync(path.join(SOCIAL_SRC, "social-attachments.service.ts"), "utf8"),
    );
    const cls = src.slice(src.indexOf("class SocialAttachGateDeniedException"));
    const body = cls.slice(0, cls.indexOf("\n}\n"));
    expect(body, "lớp không còn trong file").not.toBe("");
    expect(body).toMatch(/reason:\s*SocialErrorMessage/);
    expect(body).toContain("super(socialError(reason))");
  });
});
