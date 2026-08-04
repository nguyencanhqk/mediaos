import { describe, expect, it } from "vitest";
import { resolveAuditFilter } from "./chat-oversight-audit-filter";

/**
 * S7-CHAT-BE-9 🔒 — quy đổi NGÀY công ty → khoảng instant. Hàm thuần, không DB.
 *
 * Ca quan trọng nhất ở đây là **biên trên NỬA MỞ**: nó là thứ phân biệt "lọc đúng" với "lọc mất những
 * dòng cuối ngày, HTTP 200, không lỗi".
 */
const VN = "Asia/Ho_Chi_Minh"; // UTC+7, KHÔNG DST
const NY = "America/New_York"; // có DST — để chứng minh không hard-code offset

describe("resolveAuditFilter — quy đổi theo TZ công ty", () => {
  it("không có `from`/`to` ⇒ không có mốc nào (không giới hạn)", () => {
    expect(resolveAuditFilter({}, VN)).toEqual({});
  });

  it("`actorUserId` đi thẳng qua, không quy đổi gì", () => {
    const id = "22222222-2222-4222-8222-222222222222";
    expect(resolveAuditFilter({ actorUserId: id }, VN)).toEqual({ actorUserId: id });
  });

  it("`from` = 00:00 giờ VN của chính ngày đó (= 17:00Z hôm trước), BAO GỒM", () => {
    const { fromInstant } = resolveAuditFilter({ from: "2026-08-04" }, VN);
    expect(fromInstant?.toISOString()).toBe("2026-08-03T17:00:00.000Z");
  });

  it("[crown] `to` là biên NỬA MỞ ở 00:00 NGÀY KẾ — không phải 23:59:59.999", () => {
    const { toInstantExclusive } = resolveAuditFilter({ to: "2026-08-04" }, VN);
    // 00:00 ngày 05/08 giờ VN = 17:00Z ngày 04/08.
    expect(toInstantExclusive?.toISOString()).toBe("2026-08-04T17:00:00.000Z");

    // Vì sao mốc đóng là sai: `audit_logs.created_at` giữ tới micro-giây, nên một dòng lúc
    // 23:59:59.9995 giờ VN LỚN HƠN mốc `…23:59:59.999` và bị mất. Với biên nửa mở thì nó vẫn nằm trong.
    const late = new Date("2026-08-04T16:59:59.999Z"); // 23:59:59.999 giờ VN
    expect(late.getTime()).toBeLessThan((toInstantExclusive as Date).getTime());
  });

  it("cùng một cặp ngày cho HAI khoảng KHÁC NHAU ở hai TZ — đó là lý do quy đổi phải ở server", () => {
    const vn = resolveAuditFilter({ from: "2026-08-04", to: "2026-08-04" }, VN);
    const utc = resolveAuditFilter({ from: "2026-08-04", to: "2026-08-04" }, "UTC");
    expect(vn.fromInstant?.toISOString()).not.toBe(utc.fromInstant?.toISOString());
  });

  it("cuối tháng: `to = 2026-08-31` cuộn sang 01/09, không phải 32/08", () => {
    const { toInstantExclusive } = resolveAuditFilter({ to: "2026-08-31" }, "UTC");
    expect(toInstantExclusive?.toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });

  it("năm nhuận: `to = 2028-02-29` cuộn sang 01/03", () => {
    const { toInstantExclusive } = resolveAuditFilter({ to: "2028-02-29" }, "UTC");
    expect(toInstantExclusive?.toISOString()).toBe("2028-03-01T00:00:00.000Z");
  });

  it("TZ có DST: offset lấy theo ĐÚNG ngày, không phải một hằng số", () => {
    // 2026-01-15 → EST (UTC-5) ⇒ 00:00 local = 05:00Z. 2026-07-15 → EDT (UTC-4) ⇒ 04:00Z.
    expect(resolveAuditFilter({ from: "2026-01-15" }, NY).fromInstant?.toISOString()).toBe(
      "2026-01-15T05:00:00.000Z",
    );
    expect(resolveAuditFilter({ from: "2026-07-15" }, NY).fromInstant?.toISOString()).toBe(
      "2026-07-15T04:00:00.000Z",
    );
  });

  it("ngày chuyển DST không ném và cho đúng MỘT instant ổn định", () => {
    // 2026-03-08 là ngày spring-forward ở NY (02:00 → 03:00). 00:00 vẫn tồn tại, nhưng đây là ca đóng
    // đinh "không ném/không NaN ở biên" của `wallTimeToInstant`.
    const { fromInstant } = resolveAuditFilter({ from: "2026-03-08" }, NY);
    expect(fromInstant).toBeInstanceOf(Date);
    expect(Number.isNaN(fromInstant?.getTime())).toBe(false);
  });
});
