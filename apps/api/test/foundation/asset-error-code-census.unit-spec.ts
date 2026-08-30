/**
 * S11-ASSET-QA-1 — CENSUS "mã lỗi ASSET được NÉM mà KHÔNG có ca test nào" (SPEC-13 §21 hàng
 * "Validate: 16 mã lỗi §12, mỗi mã ≥ 1 ca").
 *
 * VÌ SAO CẦN CỔNG TĨNH CHỨ KHÔNG CHỈ ĐẾM COVERAGE. Coverage dòng của `src/assets/**` đã 97% ngay sau
 * S11-ASSET-BE-1 — vậy mà `ASSET-ERR-003` KHÔNG có lấy một ca nào (đo 30/08/2026): dòng ném nó nằm
 * trong nhánh mà mọi spec đi qua đều rẽ hướng khác. Con số coverage cao vì thế KHÔNG trả lời được câu
 * hỏi của §21 ("mỗi mã có ca chưa"), và một mã lỗi không ai chạm là mã có thể xoá / đổi thành 500 mà
 * lưới vẫn xanh.
 *
 * LUẬT ĐANG ĐO:
 *   (1) mã ĐƯỢC NÉM trong `src/assets/**` ⇒ PHẢI xuất hiện trong ít nhất một assert của bề mặt test
 *       ASSET (int-spec `test/integration/*asset*` ∪ unit spec colocated `src/assets/*.spec.ts`);
 *   (2) hai mã "biên Zod" (`REASON_REQUIRED` 009 · `RETURN_CONDITION` 016) PHẢI **không** được ném ở
 *       src — SPEC-13 §12 đính chính 30/08: hai vế đó chặn ở Zod và trả `400 VALIDATION-ERR-001`, nên
 *       hằng số còn lại chỉ để đối chiếu tài liệu. Nếu một ngày service ném chúng thật, cổng này ĐỎ và
 *       buộc bổ sung ca runtime — đúng thứ tự, không im lặng.
 *
 * LỚP BẰNG CHỨNG: đây là quét TĨNH trên chuỗi ⇒ nó KHÔNG chứng minh ca test là ca ĐÚNG, chỉ chứng minh
 * "có ai đó neo mã này". Bằng chứng mạnh nằm ở int-spec chạy đường HTTP thật. Vai của census là chặn mã
 * THỨ MƯỜI TÁM mọc lên mà không ai đo (khuôn `route-census-runtime-gate` · `body-validation-census`).
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ASSET_ERR_CODE } from "../../src/assets/assets.errors";

const ASSETS_SRC = path.join(__dirname, "..", "..", "src", "assets");
const INTEGRATION = path.join(__dirname, "..", "integration");

/**
 * Bỏ comment TRƯỚC khi quét. Không bỏ thì một dòng docblock nhắc tên mã cũng "đủ tư cách" làm bằng
 * chứng — đúng cái bẫy `vitest-exclude-selfcheck-reads-comments` đã vấp ở cổng khác.
 */
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const readAll = (dir: string, match: (name: string) => boolean): string =>
  fs
    .readdirSync(dir)
    .filter(match)
    .map((n) => stripComments(fs.readFileSync(path.join(dir, n), "utf8")))
    .join("\n");

/** Mã CHỈ tồn tại để đối chiếu tài liệu — đường thật chặn ở Zod (400 VALIDATION-ERR-001). */
const BOUNDARY_ONLY = ["REASON_REQUIRED", "RETURN_CONDITION"] as const;

describe("S11-ASSET-QA-1 census — mọi mã lỗi ASSET được ném đều có ca test", () => {
  // Nguồn NÉM: chỉ file thi công, KHÔNG lấy `*.spec.ts` colocated (spec nhắc mã là "ca test", không
  // phải "chỗ ném") — trộn hai vai vào nhau là census tự chứng minh chính nó.
  const implSrc = readAll(
    ASSETS_SRC,
    (n) => n.endsWith(".ts") && !n.endsWith(".spec.ts") && n !== "assets.errors.ts",
  );
  // `assets.errors.ts` là nơi ĐỊNH NGHĨA + nơi map lỗi PG → mã; nó cũng ném thật (mapper), nên tính vào
  // nguồn ném NHƯNG phải bỏ khối khai báo hằng (mọi mã đều xuất hiện ở đó).
  const errorsFile = stripComments(
    fs.readFileSync(path.join(ASSETS_SRC, "assets.errors.ts"), "utf8"),
  ).replace(/export const ASSET_ERR_CODE = \{[\s\S]*?\} as const;/, "");

  const thrownSrc = `${implSrc}\n${errorsFile}`;
  const testSurface = [
    readAll(ASSETS_SRC, (n) => n.endsWith(".spec.ts")),
    readAll(
      INTEGRATION,
      (n) => n.includes("asset") && (n.endsWith(".int-spec.ts") || n.endsWith(".unit-spec.ts")),
    ),
  ].join("\n");

  const isThrown = (constName: string): boolean =>
    new RegExp(`ASSET_ERR_CODE\\.${constName}\\b`).test(thrownSrc);

  const entries = Object.entries(ASSET_ERR_CODE) as Array<[string, string]>;

  it.each(entries.filter(([name]) => !BOUNDARY_ONLY.includes(name as never)))(
    "%s (%s): được ném ở src ⇒ có ít nhất một ca test neo mã",
    (name, code) => {
      expect(
        isThrown(name),
        `${name} không còn được ném ở src/assets — gỡ hằng hoặc gỡ khỏi census`,
      ).toBe(true);
      expect(
        testSurface.includes(code),
        `mã ${code} (${name}) được ném nhưng KHÔNG spec nào của ASSET assert nó`,
      ).toBe(true);
    },
  );

  it.each(BOUNDARY_ONLY.map((n) => [n, ASSET_ERR_CODE[n]] as const))(
    "%s (%s): chặn ở BIÊN Zod ⇒ không được ném ở src (đính chính SPEC-13 §12, 30/08/2026)",
    (name, code) => {
      expect(
        isThrown(name),
        `${code} giờ ĐƯỢC ném ở src — phải bổ sung ca runtime rồi chuyển ${name} ra khỏi BOUNDARY_ONLY`,
      ).toBe(false);
      // Vế dương: hai mã này vẫn phải có ca ở BIÊN (400) — spec BE-1 giữ, census neo bằng mã Zod chung.
      expect(
        testSurface.includes("VALIDATION-ERR-001"),
        "không còn ca biên 400 nào cho ASSET — 009/016 mất bằng chứng",
      ).toBe(true);
    },
  );

  it("census tự-kiểm: bề mặt test đọc được và KHÔNG rỗng", () => {
    // Không có vế này thì mọi ca trên xanh-rỗng khi đường dẫn đổi (đọc trúng thư mục trống).
    expect(thrownSrc.length).toBeGreaterThan(5_000);
    expect(testSurface.length).toBeGreaterThan(20_000);
    expect(entries.length).toBe(17); // 14 mã số §12 (012/013 dùng sentinel NOT-FOUND) + 3 sentinel
  });
});
