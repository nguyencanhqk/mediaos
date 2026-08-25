import { describe, expect, it } from "vitest";
import { idLikeParamSites, unpipedIdParamSites } from "./param-uuid-census";

/**
 * S10-FND-PARAMUUID-1 (KI-077) — RATCHET kênh PARAM: **không mọc thêm** tham số `:id` bỏ validate.
 *
 * Song song với `body-validation-ratchet.unit-spec.ts` (kênh BODY, KI-068). Hai kênh, cùng một cơ
 * chế hỏng, nên phải có hai cái đếm — dấu gạch của KI-068 CHỈ phủ kênh BODY.
 *
 * KHÔNG cần Postgres: spec TĨNH ⇒ chạy ở MỌI lần `pnpm test`, không rơi vào lớp "xanh vì SKIP"
 * ([[integration-test-lane-db-gate]]).
 */

/**
 * TRẦN đóng băng theo SỐ ĐO 25/08/2026 — **SAU** bản vá của WO này: `ID_LIKE=298` · `PIPED=77` ·
 * `UNPIPED=221`. Trước vá là **226** (WO này vá 5 tham số của `foundation/files`).
 *
 * ⚠️ ĐÂY LÀ TRẦN, KHÔNG PHẢI MỤC TIÊU. Nó KHÔNG nói "221 chỗ này an toàn" — chỉ **5** chỗ từng được
 * đo bằng HTTP thật (5 route `foundation/files`, cả 5 trả 500 trước vá). 216 chỗ còn lại chưa ai
 * chạm; đoán chúng cũng 500 là đúng thứ `done_when` của WO cấm ("đừng ép số cho khớp mô tả").
 *
 * ⚠️ HẠ TRẦN LÀ HÀNH VI ĐÚNG. Vá một chỗ ⇒ số giảm ⇒ hạ hằng này xuống theo. Ca (3) ép điều đó:
 * để trần cao hơn thực tế là để lại chỗ trống cho nợ mới lẻn vào mà không ai thấy.
 *
 * ⛔ NÂNG TRẦN là tuyên bố thêm nợ, phải giải trình trong PR.
 */
const UNPIPED_CEILING = 221;

/**
 * Module ĐÃ VÁ ⇒ đòi bằng 0, không đòi "không tăng". Đây là chỗ KI-077 sinh ra và là chỗ duy nhất có
 * số đo HTTP; để nó chỉ chịu trần chung nghĩa là tham số thứ sáu của chính module này lẻn vào được.
 */
const CLEAN_PREFIXES = ["foundation/files/"];

describe("S10-FND-PARAMUUID-1 — ratchet: tham số :id phải validate ở BIÊN", () => {
  it("(1) module ĐÃ VÁ (foundation/files) KHÔNG còn tham số id-like nào thiếu pipe", () => {
    const offenders = unpipedIdParamSites().filter((s) =>
      CLEAN_PREFIXES.some((p) => s.file.startsWith(p)),
    );
    const detail = offenders.map((s) => `  ${s.file}:${s.line}  @Param("${s.name}")`).join("\n");
    expect(
      offenders.length,
      offenders.length === 0
        ? ""
        : [
            "",
            `Có ${offenders.length} tham số id-like thiếu pipe trong module ĐÃ VÁ:`,
            detail,
            "",
            'Vá theo khuôn cùng cây: `@Param("id", ParseUUIDPipe) id: string`',
            "(`api-keys.controller.ts` dùng nó từ trước).",
            "",
            '⚠️ Route `unlink` có `:id` TRONG ĐƯỜNG DẪN nhưng handler KHÔNG KHAI `@Param("id")` —',
            "nó không đọc tham số đó bao giờ. Vì thế census KHÔNG thấy, và đó là ĐÚNG: không có gì để",
            'validate. Nếu ai đó thêm `@Param("id")` vào `unlink` thì ca này sẽ đỏ — hãy đọc docblock',
            "của route trước khi vá, vì việc BẮT ĐẦU đọc `:id` là một đổi hành vi, không phải sửa lint.",
          ].join("\n"),
    ).toBe(0);
  });

  it("(2) TOÀN API: số tham số id-like thiếu pipe KHÔNG vượt trần đã ký", () => {
    const all = unpipedIdParamSites();
    expect(
      all.length,
      `Có ${all.length} tham số id-like thiếu pipe, trần đã ký là ${UNPIPED_CEILING}.\n` +
        "Tham số MỚI viết theo khuôn cũ sẽ trả 500 SYSTEM-ERR-001 cho input rác thay vì 400 —\n" +
        "vừa sai hợp đồng API vừa bơm 500 GIẢ vào giám sát, làm loãng tín hiệu 500 THẬT.\n" +
        'Vá bằng `@Param("x", ParseUUIDPipe)`, hoặc nâng trần kèm giải trình trong PR.',
    ).toBeLessThanOrEqual(UNPIPED_CEILING);
  });

  it("(3) trần KHÔNG được để CAO HƠN thực tế — vá xong phải hạ trần", () => {
    // Trần cao hơn thực tế là chỗ trống cho nợ mới lẻn vào mà ca (2) vẫn xanh. Ca này biến việc hạ
    // trần thành BẮT BUỘC, không phải lịch sự ([[index-ratchet-must-pin-definition-not-name]]).
    expect(
      unpipedIdParamSites().length,
      `Đã vá bớt rồi — hạ UNPIPED_CEILING xuống ${unpipedIdParamSites().length} trong file này.`,
    ).toBe(UNPIPED_CEILING);
  });

  it("(4) census KHÔNG rỗng và phân biệt được CÓ pipe với KHÔNG — chống xanh-rỗng", () => {
    // Nếu scanner hỏng (đổi tên decorator, parse lỗi, đổi cây thư mục) thì ca (1)/(2) xanh vì KHÔNG
    // TÌM THẤY GÌ, không phải vì sạch ([[test-noise-anchor-hides-a-branch]]).
    const sites = idLikeParamSites();
    expect(sites.length, "scanner không thấy @Param id-like nào — nó đang hỏng").toBeGreaterThan(
      100,
    );
    // Neo DƯƠNG: phải thấy CẢ HAI phía. Chỉ thấy một phía nghĩa là cờ `hasPipe` đang hỏng cứng.
    expect(
      sites.filter((s) => s.hasPipe).length,
      "scanner không thấy tham số nào CÓ pipe — cờ hasPipe hỏng, mọi kết luận đều vô nghĩa",
    ).toBeGreaterThan(0);
    expect(
      sites.filter((s) => !s.hasPipe).length,
      "scanner không thấy tham số nào THIẾU pipe — cờ hasPipe hỏng theo chiều ngược lại",
    ).toBeGreaterThan(0);
    // Neo ALIAS: `:linkId` phải nằm trong census — grep theo `@Param("id")` sẽ trượt nó, và chính
    // cú trượt đó là lý do WO kê nó riêng ([[identity-projection-census-misses-alias]]).
    expect(
      sites.some((s) => s.name.endsWith("Id") && s.name !== "id"),
      "census chỉ thấy tham số tên đúng `id` — nó đang trượt các alias `*Id`",
    ).toBe(true);
  });
});
