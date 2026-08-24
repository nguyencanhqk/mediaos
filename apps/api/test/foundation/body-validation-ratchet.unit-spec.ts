import { describe, expect, it } from "vitest";
import { bodyHandlers, unvalidatedBodyHandlers, zodDtoClassNames } from "./body-validation-census";

/**
 * S10-FND-BODYVALIDATE-1 (KI-068) — RATCHET: không handler GHI nào được nhận `@Body()` mà bỏ qua
 * validate ở BIÊN.
 *
 * VÌ SAO CẦN LỚP NÀY. Vá 4 route là việc một lần; thứ làm nợ quay lại là route **THỨ NĂM** viết theo
 * khuôn cũ. Tiền lệ ngay trong cùng đợt: KI-047 mở ngày 29/07 với "4 đường 429 không ghi log", đo lại
 * ngày 24/08 thành **5** — `step-up.service.ts` mọc thêm và không ai thấy vì không có ratchet.
 *
 * KHÔNG cần Postgres: spec TĨNH (`*.unit-spec.ts`, glob đã khai ở `vitest.config.ts:49`) ⇒ chạy ở MỌI
 * lần `pnpm test`, kể cả khi không có `LANE_DB` ⇒ không rơi vào lớp "xanh vì SKIP"
 * ([[integration-test-lane-db-gate]]).
 *
 * NEO THEO ĐỊNH NGHĨA, KHÔNG THEO TÊN. Ca (1) đối chiếu **metatype với tập class `createZodDto`** chứ
 * không liệt kê tên 4 route đã vá — danh sách tên sẽ xanh vĩnh viễn khi route thứ 5 xuất hiện
 * ([[index-ratchet-must-pin-definition-not-name]]).
 */

/**
 * Waiver ĐÃ KÝ — handler cố ý không validate ở biên, kèm lý do. Hiện **RỖNG**.
 *
 * Thêm một dòng vào đây là hành vi có chủ ý và phải giải trình được trong PR: nó nới đúng cái bất biến
 * mà KI-068 sinh ra để giữ. Khoá là `<Controller>#<method>` (ổn định hơn route string).
 */
const WAIVERS: ReadonlyMap<string, string> = new Map<string, string>([]);

describe("S10-FND-BODYVALIDATE-1 — ratchet: @Body() phải validate ở BIÊN", () => {
  it("(1) KHÔNG handler GHI nào nhận @Body() mà bỏ qua validate ở biên (trừ waiver đã ký)", () => {
    const offenders = unvalidatedBodyHandlers().filter((h) => !WAIVERS.has(h.key));
    const detail = offenders
      .map((h) => `  ${h.verb.toUpperCase()} ${h.key}  :${h.bodyType}  (${h.file}:${h.line})`)
      .join("\n");
    expect(
      offenders.length,
      offenders.length === 0
        ? ""
        : [
            "",
            `Có ${offenders.length} handler GHI nhận @Body() KHÔNG validate ở BIÊN — đó là hình dạng của KI-068:`,
            detail,
            "",
            "Body sai hợp đồng sẽ trả 500 SYSTEM-ERR-001 thay vì 400 (ZodError THÔ, AllExceptionsFilter",
            "không hiểu). Cách vá đúng khuôn nhà: dựng class DTO trong `<module>.dto.ts`:",
            "",
            "    export class XDto extends createZodDto(xSchema) {}",
            "",
            "rồi đổi `@Body() body: XInput` (TYPE) sang `@Body() body: XDto` (CLASS).",
            "⚠️ `@UsePipes(ZodValidationPipe)` CẤP CLASS KHÔNG cứu được — pipe lấy schema từ metatype,",
            "mà `z.infer` bị xoá lúc chạy. Xem `docs/plans/S10-FND-BODYVALIDATE-1.md` §2.",
          ].join("\n"),
    ).toBe(0);
  });

  it("(2) census KHÔNG rỗng — chống xanh-rỗng khi scanner hỏng", () => {
    // Nếu AST scanner hỏng (đổi cây thư mục, đổi tên decorator, parse lỗi) thì ca (1) sẽ xanh vì
    // KHÔNG TÌM THẤY GÌ, không phải vì sạch. Hai neo dưới đây là điều kiện để tin ca (1)
    // ([[test-noise-anchor-hides-a-branch]]).
    const handlers = bodyHandlers();
    expect(
      handlers.length,
      "scanner không thấy handler GHI nào có @Body() — nó đang hỏng",
    ).toBeGreaterThan(100);
    expect(
      zodDtoClassNames().size,
      "scanner không thấy class createZodDto nào — mọi handler sẽ bị báo vi phạm oan",
    ).toBeGreaterThan(100);
  });

  it("(3) bốn route của KI-068 nay ĐỀU validate ở biên", () => {
    // Neo BỔ SUNG cho ca (1) — không thay thế nó. Ca này bắt đúng kịch bản hồi quy có thật: ai đó
    // revert `.dto.ts` rồi thêm `@UsePipes` cấp class và tưởng là tương đương.
    const wanted = new Set([
      "ApiKeysController#create",
      "FilesController#upload",
      "FilesController#confirm",
      "FilesController#link",
    ]);
    const found = bodyHandlers().filter((h) => wanted.has(h.key));
    expect(
      found.map((h) => h.key).sort(),
      "4 handler của KI-068 phải còn tồn tại đúng tên",
    ).toEqual([...wanted].sort());
    for (const h of found) {
      expect(h.validatedAtBoundary, `${h.key} (:${h.bodyType}) không còn validate ở biên`).toBe(
        true,
      );
    }
  });
});
