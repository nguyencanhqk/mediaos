/**
 * S20-TASK-WORKLOAD-1 — vị từ + hằng dùng chung của màn «Đội của tôi» (plan D2 · D4).
 * DENY đứng cạnh ALLOW ở tầng SQL render: Own KHÔNG có vế `IS NULL` («Chưa giao»), Team/Department có.
 */
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  TASK_DUE_SOON_DAYS,
  buildAssigneeScopeExists,
  buildWorkloadPersonPredicate,
  dueSoonWindowEnd,
  taskOpenPredicate,
  taskOverduePredicate,
} from "./task-workload.predicates";
import { TaskCoreRepository } from "./task-core.repository";

const dialect = new PgDialect();
const render = (q: ReturnType<typeof sql>) => dialect.sqlToQuery(q);
const SCOPE_COND = sql`employee_profiles.company_id = ${"co-1"}`;

describe("hằng dùng chung", () => {
  it("cửa sổ sắp hạn là 7 ngày", () => {
    expect(TASK_DUE_SOON_DAYS).toBe(7);
  });

  it("taskOpenPredicate: mở = NULL hoặc không Done/Cancelled", () => {
    const { sql: text } = render(taskOpenPredicate("tk"));
    expect(text).toContain("tk.task_status is null");
    expect(text).toContain("not in ('Done','Cancelled')");
  });

  it("taskOverduePredicate: due_at < now() và mở (cùng văn bản với bộ lọc overdue của danh sách)", () => {
    const { sql: text } = render(taskOverduePredicate("tk"));
    expect(text).toContain("tk.due_at is not null");
    expect(text).toContain("tk.due_at < now()");
    expect(text).toContain("not in ('Done','Cancelled')");
  });

  it("taskOverduePredicate nhận đồng hồ tường minh (chống lệch nửa đêm)", () => {
    const q = render(taskOverduePredicate("tk", sql`${"2026-01-01T00:00:00Z"}::timestamptz`));
    expect(q.sql).not.toContain("now()");
    expect(q.params).toContain("2026-01-01T00:00:00Z");
  });

  it("alias lạ bị từ chối (không nối chuỗi SQL từ đầu vào)", () => {
    expect(() => taskOpenPredicate("tk; drop table tasks")).toThrow();
  });
});

describe("dueSoonWindowEnd — đầu ngày (hôm nay + 8) theo GIỜ CÔNG TY", () => {
  it("Asia/Ho_Chi_Minh: 23:59:59 và 00:00:00 qua nửa đêm công ty ⇒ cửa sổ dời đúng 1 ngày", () => {
    const a = dueSoonWindowEnd(new Date("2026-11-11T16:59:59Z"), "Asia/Ho_Chi_Minh");
    const b = dueSoonWindowEnd(new Date("2026-11-11T17:00:00Z"), "Asia/Ho_Chi_Minh");
    expect(a.toISOString()).toBe("2026-11-18T17:00:00.000Z");
    expect(b.toISOString()).toBe("2026-11-19T17:00:00.000Z");
  });

  it("múi giờ âm (America/New_York) vẫn đúng biên nửa đêm", () => {
    const a = dueSoonWindowEnd(new Date("2026-11-12T04:59:59Z"), "America/New_York");
    const b = dueSoonWindowEnd(new Date("2026-11-12T05:00:00Z"), "America/New_York");
    expect(a.toISOString()).toBe("2026-11-19T05:00:00.000Z");
    expect(b.toISOString()).toBe("2026-11-20T05:00:00.000Z");
  });

  it("việc hạn hôm-nay+7 23:59 nằm TRONG cửa sổ, hôm-nay+8 00:00 nằm NGOÀI (loại trừ)", () => {
    const end = dueSoonWindowEnd(new Date("2026-11-11T03:00:00Z"), "Asia/Ho_Chi_Minh");
    const in7 = new Date("2026-11-18T16:59:00Z");
    const at8 = new Date("2026-11-18T17:00:00Z");
    expect(in7.getTime()).toBeLessThan(end.getTime());
    expect(at8.getTime()).toBeGreaterThanOrEqual(end.getTime());
  });
});

describe("buildWorkloadPersonPredicate — «người xuất hiện» (D2/D3)", () => {
  it("Company/System ⇒ không thêm vị từ", () => {
    expect(buildWorkloadPersonPredicate("Company", undefined)).toBeUndefined();
    expect(buildWorkloadPersonPredicate("System", undefined)).toBeUndefined();
  });

  it("Team/Department ⇒ có vế `IS NULL OR` (giữ nhóm Chưa giao)", () => {
    for (const s of ["Team", "Department"] as const) {
      const p = buildWorkloadPersonPredicate(s, SCOPE_COND);
      expect(p).toBeDefined();
      const text = render(p as ReturnType<typeof sql>).sql;
      expect(text).toContain("tk.main_assignee_employee_id is null or");
      expect(text).toContain("employee_profiles.deleted_at is null");
    }
  });

  it("Own ⇒ KHÔNG có vế IS NULL, chỉ nhánh người thuộc phạm vi (DENY Chưa giao ở tầng SQL)", () => {
    const text = render(
      buildWorkloadPersonPredicate("Own", SCOPE_COND) as ReturnType<typeof sql>,
    ).sql;
    expect(text).not.toMatch(/is null or/i);
    expect(text).toContain("employee_profiles.id = tk.main_assignee_employee_id");
  });

  it("scope hẹp mà thiếu scopeCond ⇒ ném (fail-closed, không match-all)", () => {
    expect(() => buildWorkloadPersonPredicate("Team", undefined)).toThrow();
  });
});

describe("neo chéo D2 — buildReadScopeExists chứa nguyên văn buildAssigneeScopeExists", () => {
  it("văn bản + tham số của nhánh (A) không trôi khỏi bản gốc", () => {
    const repo = new TaskCoreRepository();
    const branchA = render(buildAssigneeScopeExists(SCOPE_COND));
    const full = render(repo.buildReadScopeExists("co-1", SCOPE_COND, "emp-1", "usr-1"));
    expect(full.sql).toContain(branchA.sql);
    expect(full.params.slice(0, branchA.params.length)).toEqual(branchA.params);
    expect(render(repo.buildAssigneeScopeExists(SCOPE_COND)).sql).toBe(branchA.sql);
  });
});
