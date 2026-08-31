/**
 * S12-RECRUIT-QA-1 — CENSUS "mã lỗi / `kind` RECRUIT được NÉM mà KHÔNG có ca test nào" (SPEC-12 §12,
 * khuôn `room-error-code-census` — phiên bản theo-MÃ VÀ theo-KIND, không theo dòng).
 *
 * RECRUIT có đúng bài toán "nhiều biến thể chung một mã" như ROOM: 003 gộp `invalid-offer-transition`
 * + `not-draft`, 004 gộp 3 kind, 008 gộp 4 kind, 009 gộp 5 kind (2 nhánh 422 + 2 nhánh 404 chống
 * oracle + inactive), 013 gộp 2. "Mã 009 đã có ca" hoàn toàn có thể đúng trong khi `position-invalid`
 * và `recruiter-invalid` chưa ai chạm (đo 31/08/2026: đúng 3 kind ở tình trạng đó — thêm
 * `interview-cancelled`; ca runtime bổ sung nằm ở `s12-recruit-qa1-error-residue`). Bài học
 * `coverage-high-but-error-code-untested`.
 *
 * LUẬT ĐANG ĐO:
 *   (1) key trong `RECRUIT_ERR_CODE` được NÉM ở `src/recruit/**` (dạng arg đầu
 *       `recruitConflict("KEY"…)`/`recruitUnprocessable(…)`/`body("KEY"…)`) ⇒ mã tương ứng PHẢI xuất
 *       hiện trong ít nhất một assert của bề mặt test RECRUIT (int-spec `test/integration/*recruit*`
 *       ∪ unit spec colocated `src/recruit/*.spec.ts`);
 *   (2) mỗi `kind` ném được (literal `recruitDetails("…")` ở src) cũng phải có ca.
 *
 * LỚP BẰNG CHỨNG: quét TĨNH trên chuỗi — không chứng minh ca test ĐÚNG, chỉ chặn kind THỨ HAI MƯƠI
 * TÁM mọc lên mà không ai đo (khuôn `route-census-runtime-gate`).
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RECRUIT_ERR_CODE } from "../../src/recruit/recruit.errors";

const RECRUIT_SRC = path.join(__dirname, "..", "..", "src", "recruit");
const INTEGRATION = path.join(__dirname, "..", "integration");

/** Bỏ comment TRƯỚC khi quét — docblock nhắc mã không được tính là bằng chứng (bẫy `vitest-exclude-selfcheck-reads-comments`). */
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const readAll = (dir: string, match: (name: string) => boolean): string =>
  fs
    .readdirSync(dir)
    .filter(match)
    .map((n) => stripComments(fs.readFileSync(path.join(dir, n), "utf8")))
    .join("\n");

describe("S12-RECRUIT-QA-1 census — mọi mã lỗi & kind RECRUIT được ném đều có ca test", () => {
  // Nguồn NÉM: chỉ file thi công — KHÔNG lấy `*.spec.ts` colocated (spec nhắc mã là "ca test",
  // không phải "chỗ ném").
  const implSrc = readAll(
    RECRUIT_SRC,
    (n) => n.endsWith(".ts") && !n.endsWith(".spec.ts") && n !== "recruit.errors.ts",
  );
  // `recruit.errors.ts` vừa ĐỊNH NGHĨA vừa NÉM thật (`mapRecruitPgError`, `recruitNotFound`,
  // `recruitPeopleRefNotFound`) — tính vào nguồn ném NHƯNG bỏ hai khối khai báo hằng.
  const errorsFile = stripComments(
    fs.readFileSync(path.join(RECRUIT_SRC, "recruit.errors.ts"), "utf8"),
  )
    .replace(/export const RECRUIT_ERR_CODE = \{[\s\S]*?\} as const;/, "")
    .replace(/export const RECRUIT_ERR = \{[\s\S]*?\n\} as const;/, "");

  const thrownSrc = `${implSrc}\n${errorsFile}`;
  const testSurface = [
    readAll(RECRUIT_SRC, (n) => n.endsWith(".spec.ts")),
    readAll(
      INTEGRATION,
      (n) => /recruit/i.test(n) && (n.endsWith(".int-spec.ts") || n.endsWith(".unit-spec.ts")),
    ),
  ].join("\n");

  /**
   * RECRUIT ném qua helper với KEY là arg đầu (`recruitConflict("STAGE_TRANSITION", …)`) — khác ROOM
   * (tham chiếu `ROOM_ERR_CODE.X` trực tiếp). Bằng chứng "được ném" = key xuất hiện dạng chuỗi
   * `"KEY"` trong nguồn ném (sau khi đã bỏ khối khai báo hằng nên không tự-chứng-minh).
   */
  const isThrown = (constName: string): boolean => new RegExp(`"${constName}"`).test(thrownSrc);

  const codeEntries = Object.entries(RECRUIT_ERR_CODE) as Array<[string, string]>;

  it.each(codeEntries)(
    "mã %s (%s): được ném ở src ⇒ có ít nhất một ca test neo mã",
    (name, code) => {
      expect(
        isThrown(name),
        `${name} không còn được ném ở src/recruit — gỡ hằng hoặc gỡ khỏi census`,
      ).toBe(true);
      expect(
        testSurface.includes(code),
        `mã ${code} (${name}) được ném nhưng KHÔNG spec nào của RECRUIT assert nó`,
      ).toBe(true);
    },
  );

  /** Tập `kind` ném được — MỘT nguồn duy nhất: literal `recruitDetails("…")` ở nguồn ném (`\s*` nuốt wrap của Prettier). */
  const kinds = (): string[] => {
    const out = new Set<string>();
    for (const m of thrownSrc.matchAll(/recruitDetails\(\s*"([a-z0-9-]+)"/g)) out.add(m[1]);
    return [...out].sort();
  };

  it.each(kinds())("kind `%s`: ném được ở src ⇒ có ít nhất một ca test neo kind", (kind) => {
    expect(
      testSurface.includes(`"${kind}"`),
      `kind ${kind} ném được nhưng KHÔNG spec nào của RECRUIT assert nó`,
    ).toBe(true);
  });

  it("census tự-kiểm: bề mặt đọc được và KHÔNG rỗng", () => {
    // Không có vế này thì mọi ca trên xanh-rỗng khi đường dẫn đổi (đọc trúng thư mục trống).
    expect(thrownSrc.length).toBeGreaterThan(10_000);
    expect(testSurface.length).toBeGreaterThan(50_000);
    // SPEC-12 §12: đúng 15 mã RECRUIT-ERR-001…015.
    expect(codeEntries.length).toBe(15);
    // 27 kind ném được (mirror FE `RECRUIT_ERROR_KINDS` — fs-pin phía app giữ vế FE↔BE).
    expect(kinds().length).toBe(27);
  });
});
