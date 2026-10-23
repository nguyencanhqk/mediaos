import { describe, expect, it } from "vitest";
import { REPORT_ACTION_MATRIX, feedReportActionSchema, feedTargetTypeSchema } from "./index";

/**
 * S16-SOCIAL-REPORTMATRIX-1 — ma trận «loại đích → hành động kèm hợp lệ» của `SOCIAL-API-029` là MỘT
 * hằng của hợp đồng, export qua index của gói. BE (`apps/api/src/social/social-report-actions.ts`, cổng
 * 422) và FE (`apps/app/src/routes/social/moderation/lib/report-actions.ts`, lựa chọn của hộp thoại)
 * cùng import nó — không còn bản chép tay nào để trôi lệch.
 *
 * Giá trị so với câu VIẾT TAY (quyết định D2 của S16-SOCIAL-BE-3A), không suy từ chính hằng.
 */
describe("REPORT_ACTION_MATRIX — ma trận 029 trong contracts", () => {
  it("export qua index của gói: đúng từng hàng, đúng thứ tự hiển thị", () => {
    expect(REPORT_ACTION_MATRIX).toEqual({
      post: ["none", "hide_post", "lock_comments", "delete_target"],
      comment: ["none", "lock_comments", "delete_target"],
    });
  });

  it("phủ ĐÚNG mọi loại đích của enum; mọi ô thuộc enum hành động, không lặp", () => {
    expect(Object.keys(REPORT_ACTION_MATRIX).sort()).toEqual(
      [...feedTargetTypeSchema.options].sort(),
    );
    const known: readonly string[] = feedReportActionSchema.options;
    for (const row of Object.values(REPORT_ACTION_MATRIX)) {
      expect(new Set(row).size).toBe(row.length);
      for (const action of row) expect(known).toContain(action);
    }
  });

  it("`none` đứng ĐẦU mọi hàng (giá trị mặc định của ô chọn ở FE)", () => {
    for (const row of Object.values(REPORT_ACTION_MATRIX)) expect(row[0]).toBe("none");
  });

  it("đích `comment` KHÔNG có `hide_post`; đích `post` CÓ", () => {
    expect(REPORT_ACTION_MATRIX.post).toContain("hide_post");
    expect(REPORT_ACTION_MATRIX.comment).not.toContain("hide_post");
  });
});
