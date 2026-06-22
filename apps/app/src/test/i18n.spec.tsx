import { describe, expect, it } from "vitest";
import i18n from "@/i18n";

/**
 * i18n vi đã khởi tạo (qua @mediaos/web-core) — namespace `common` có mặt, không missing key.
 * Khẳng định vỏ nghiệp vụ render đúng chuỗi tiếng Việt cho state dùng chung (loading/empty).
 */
describe("apps/app i18n (vi)", () => {
  it("t('common:loading') = 'Đang tải…'", () => {
    expect(i18n.t("common:loading")).toBe("Đang tải…");
  });

  it("t('common:noData') = 'Không có dữ liệu'", () => {
    expect(i18n.t("common:noData")).toBe("Không có dữ liệu");
  });
});
