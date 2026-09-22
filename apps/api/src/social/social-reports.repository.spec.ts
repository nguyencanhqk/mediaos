import { describe, expect, it } from "vitest";
import type { DataScope } from "@mediaos/contracts";
import { SocialReportsRepository } from "./social-reports.repository";

/**
 * S16-SOCIAL-BE-1B — ca `N-H3` (plan §5.1, HIGH của vòng plan-review): **vị từ phạm vi của route
 * `028` phải VÉT CẠN 5 giá trị `DataScope`**, và mọi giá trị ngoài `Company|System|Department` phải
 * ra `false` (0 hàng) chứ không phải "không lọc" và cũng không phải một throw.
 *
 * ┌─ VÌ SAO CA NÀY TỒN TẠI ───────────────────────────────────────────────────────────────────────┐
 * │ `028` là route DUY NHẤT của SOCIAL có `companyFloor:false` — bắt buộc, vì seed `0578` cấp       │
 * │ `['manager','view','feed-report','Department']` và một sàn Company sẽ 403 chính vai đó. Nhưng   │
 * │ tắt sàn KHÔNG chỉ mở thêm `Department`: nó mở cho MỌI scope `resolveManyOrNull` trả về, kể cả   │
 * │ `Own`/`Team` — hai giá trị SPEC-16 §11.1 không định nghĩa cho cặp này. Một                      │
 * │ `if (scope === 'Department') … else <không lọc>` biến grant `view:feed-report@Own` thành quyền  │
 * │ đọc TOÀN BỘ hàng đợi của công ty. Fail-OPEN, và im lặng.                                        │
 * │                                                                                                 │
 * │ Ca này đo bằng CHÍNH vị từ SQL sinh ra (đọc `queryChunks`), không qua HTTP: nó phải đúng kể cả   │
 * │ khi không ai cấu hình được một grant `@Own` cho cặp đó hôm nay — đúng lúc ai đó cấu hình được    │
 * │ thì đã muộn.                                                                                    │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
 */

/** Trích text SQL thô từ một object `sql\`…\`` của drizzle (khuôn `outbox-worker.spec.ts`). */
function sqlText(query: unknown): string {
  const out: string[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const n = node as { value?: unknown; queryChunks?: unknown[] };
    if (typeof n.value === "string") out.push(n.value);
    if (Array.isArray(n.value)) out.push(...n.value.filter((v): v is string => typeof v === "string"));
    if (Array.isArray(n.queryChunks)) for (const c of n.queryChunks) walk(c);
  };
  walk(query);
  return out.join(" ").replace(/\s+/g, " ").trim();
}

describe("SocialReportsRepository.scopeCondition — N-H3 switch vét cạn", () => {
  const repo = new SocialReportsRepository();
  const UNITS = ["11111111-1111-4111-8111-111111111111"];

  it("Company / System ⇒ KHÔNG lọc (vị từ `true`)", () => {
    for (const scope of ["Company", "System"] as const) {
      expect(sqlText(repo.scopeCondition(scope, UNITS)), `scope=${scope}`).toBe("true");
    }
  });

  it("Department + có đơn vị ⇒ vị từ IN trên `org_unit_id` của BÀI đích (KHÔNG `true`, KHÔNG `false`)", () => {
    const text = sqlText(repo.scopeCondition("Department", UNITS));
    // Neo DƯƠNG: phải là một vị từ THẬT. Chỉ assert "≠ true" là xanh cả khi hàm trả `false`, tức
    // manager không bao giờ đọc được gì và không ca nào bắt được.
    expect(text).toContain("in");
    expect(text).not.toBe("true");
    expect(text).not.toBe("false");
  });

  it("Department + tập đơn vị RỖNG ⇒ `false` (fail-closed, KHÔNG BAO GIỜ match-all)", () => {
    expect(sqlText(repo.scopeCondition("Department", []))).toBe("false");
  });

  /**
   * 🔴 Vế QUAN TRỌNG NHẤT của cả file. `Own`/`Team` resolve được (engine trả scope mạnh nhất, không
   * ép sàn nào) và `companyFloor:false` để chúng đi lọt `resolveActor` — nên hàng rào cuối cùng là
   * đúng hai dòng `case` này.
   */
  it("Own / Team ⇒ `false` — 0 hàng, KHÔNG 'không lọc', KHÔNG throw", () => {
    for (const scope of ["Own", "Team"] as const) {
      expect(() => repo.scopeCondition(scope, UNITS)).not.toThrow();
      expect(sqlText(repo.scopeCondition(scope, UNITS)), `scope=${scope}`).toBe("false");
    }
  });

  /**
   * Giá trị `DataScope` MỚI mà file này chưa biết (engine thêm về sau) ⇒ vẫn `false`.
   *
   * Ép kiểu ở đây là CỐ Ý và là cả mục đích: `switch` vét cạn làm typecheck bắt ca này lúc BIÊN DỊCH;
   * ca này đo nhánh `default` lúc CHẠY, cho tình huống một giá trị lạ đến từ DB chứ không từ code.
   */
  it("giá trị scope lạ ⇒ `false` (lưới lúc chạy của nhánh `default`)", () => {
    expect(sqlText(repo.scopeCondition("Galaxy" as DataScope, UNITS))).toBe("false");
  });
});
