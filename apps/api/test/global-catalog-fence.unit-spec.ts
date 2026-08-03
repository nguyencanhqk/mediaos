/**
 * S7-QA-CATALOGFIXTURE-1 — unit test cho LOGIC so sánh của đai 2 (`global-catalog-fence.ts`).
 *
 * VÌ SAO CẦN, KHI ĐÃ CÓ INT-SPEC: đai 2 chỉ thực thi nhánh "phát hiện" khi có người làm bẩn catalog.
 * Ở mọi lượt chạy bình thường nó im lặng, nên một refactor làm hỏng phép so sẽ **không đỏ ở đâu cả** —
 * đai vẫn "chạy", vẫn xanh, và không còn canh gì. Cùng lý do `test/db-target.unit-spec.ts` tồn tại
 * cho đai anh em (db-fence).
 *
 * Chạy KHÔNG cần DB (`*.unit-spec.ts` nằm trong glob của vitest.config.ts).
 */

import { describe, expect, it } from "vitest";
import { diffCatalogFlags, type CatalogFlags } from "./global-catalog-fence";

const cat = (entries: Record<string, boolean>): CatalogFlags => new Map(Object.entries(entries));

describe("diffCatalogFlags — logic phát hiện ô nhiễm catalog permissions", () => {
  it("không đổi gì ⇒ im lặng", () => {
    const before = cat({ "update:project": false, "delete:project": true });
    expect(
      diffCatalogFlags(before, cat({ "update:project": false, "delete:project": true })),
    ).toEqual({
      flipped: [],
      removed: [],
    });
  });

  it("ĐỔI CỜ ⇒ báo, kèm cả hai giá trị để đọc log là sửa được", () => {
    // Đúng ca thật đã xảy ra: chat-be5 lật update:project sang sensitive ⇒ 3 ca TASKCAP đỏ ở spec khác.
    const drift = diffCatalogFlags(
      cat({ "update:project": false }),
      cat({ "update:project": true }),
    );
    expect(drift.removed).toEqual([]);
    expect(drift.flipped).toHaveLength(1);
    expect(drift.flipped[0]).toContain("update:project");
    expect(drift.flipped[0]).toContain("false");
    expect(drift.flipped[0]).toContain("true");
  });

  it("đổi cờ theo chiều NGƯỢC LẠI (true → false) cũng phải báo", () => {
    // Chiều này dễ bị bỏ sót khi refactor (vd viết `if (nowSensitive && !wasSensitive)`), mà nó
    // nguy hiểm ngang chiều kia: gỡ cờ sensitive của một cặp sản phẩm là MỞ cặp đó ra /auth/me.
    const drift = diffCatalogFlags(
      cat({ "view-salary:employee": true }),
      cat({ "view-salary:employee": false }),
    );
    expect(drift.flipped).toHaveLength(1);
    expect(drift.flipped[0]).toContain("view-salary:employee");
  });

  it("cặp BIẾN MẤT ⇒ báo (FK role_permissions là ON DELETE CASCADE — mất cặp là mất grant)", () => {
    const drift = diffCatalogFlags(
      cat({ "update:project": false, "view:doc": false }),
      cat({ "update:project": false }),
    );
    expect(drift.flipped).toEqual([]);
    expect(drift.removed).toEqual(["view:doc"]);
  });

  it("cặp MỚI ⇒ IM LẶNG — đây là lối thoát hợp lệ, đừng 'siết' nó", () => {
    // Thông báo lỗi của tuyến 1 bảo fixture "tự chế cặp RIÊNG của test". Nếu đai 2 báo cặp mới là vi
    // phạm thì lời khuyên đó thành cái bẫy, và người ta sẽ quay lại mượn cặp sản phẩm.
    const drift = diffCatalogFlags(
      cat({ "update:project": false }),
      cat({ "update:project": false, "view:px-res-abc": true, "*:*": false }),
    );
    expect(drift).toEqual({ flipped: [], removed: [] });
  });

  it("gộp nhiều vi phạm cùng lúc: báo ĐỦ, không dừng ở cái đầu tiên", () => {
    const drift = diffCatalogFlags(
      cat({ a: false, b: true, c: false, d: true }),
      cat({ a: true, b: false, d: true }),
    );
    expect(drift.flipped).toHaveLength(2);
    expect(drift.removed).toEqual(["c"]);
  });

  it("catalog rỗng ở đầu suite ⇒ không bịa vi phạm", () => {
    expect(diffCatalogFlags(cat({}), cat({ "x:y": true }))).toEqual({ flipped: [], removed: [] });
  });
});
