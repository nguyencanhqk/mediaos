import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseService } from "../../src/db/db.service";
import { AuditService } from "../../src/events/audit.service";
import { DataScopeService } from "../../src/permission/data-scope.service";
import { DataScopeRepository } from "../../src/permission/data-scope.repository";
import { PermissionService } from "../../src/permission/permission.service";
import { PermissionRepository } from "../../src/permission/permission.repository";
import { AttendanceReportService } from "../../src/attendance/attendance-report.service";
import { AttendanceReportRepository } from "../../src/attendance/attendance-report.repository";
import { LeaveReportService } from "../../src/leave/leave-report.service";
import { LeaveReportRepository } from "../../src/leave/leave-report.repository";
import { directPool, hasDb } from "../helpers/integration-db";
import {
  cleanupTenants,
  seedCompany,
  seedPermissionCatalog,
  seedRole,
  seedRolePermission,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../helpers/seed";

/**
 * S6-SEC-1 · KI-033 (RED-first) — ĐỌC BÁO CÁO TOÀN CÔNG TY PHẢI ĐỂ LẠI VẾT AUDIT.
 *
 * PHÁT HIỆN (FULL gate, và đã ĐÍNH CHÍNH lại phạm vi khi tự kiểm chứng):
 * báo cáo gate nói "leave-report là ngoại lệ duy nhất, hai sibling đều audit". Sai. Mở cả bốn file ra
 * đếm thì ra pattern khác hẳn:
 *
 *   | service                  | cổng THẬT                      | audit |
 *   | attendance-export (CSV)  | `export:attendance` (sensitive)  | CÓ    |
 *   | hr-export         (CSV)  | `export:employee`   (sensitive)  | CÓ    |
 *   | leave-report      (JSON) | `export:leave`      (sensitive)  | KHÔNG |
 *   | attendance-report (JSON) | `view-company:attendance` (sens.)| KHÔNG |
 *
 * ⇒ hai đính chính so với bản gate: (1) không phải "leave lạc đàn giữa hai sibling cùng cổng" —
 * `attendance-report` cũng không audit; (2) `attendance-report` KHÔNG gate bằng `export` mà bằng
 * `view-company`, nên "cổng giống hệt nhau" là mô tả sai.
 *
 * Chỗ chối nhất vẫn là `leave-report`: nó gate bằng CHÍNH `export:leave` — đúng ngữ nghĩa "xuất dữ
 * liệu" mà mọi đường `export:*` khác đều ghi audit — mà lại không ghi gì. `attendance-report` gate
 * bằng `view-company` (yêu cầu audit yếu hơn về mặt ngữ nghĩa) NHƯNG nó trả `employeeCode` +
 * `fullName` **từng nhân viên** trên toàn công ty, nên vẫn thuộc diện phải có vết.
 *
 * Vì sao là `S1`: `RELEASE-05` §5.2 nâng tự động — thao tác nhạy cảm không ghi audit ⇒ tối thiểu `S1`.
 * Và `IMPLEMENTATION-09` §13.2 nhóm Sensitive-data mục 5 đòi audit khi XEM/XUẤT dữ liệu nhạy cảm.
 * Hệ quả thật: HR/admin kéo bảng lương-nghỉ-công toàn công ty mà **không để lại vết nào** để hậu kiểm.
 *
 * Gate cứng `hasDb && LANE_DB` (memory integration-test-lane-db-gate).
 */

const runDb = hasDb && Boolean(process.env["LANE_DB"]);

describe.skipIf(!runDb)("S6-SEC-1 KI-033 — report toàn công ty phải ghi audit", () => {
  const direct = directPool();
  let A: SeededTenant;
  let hrUser: string;
  let attSvc: AttendanceReportService;
  let leaveSvc: LeaveReportService;
  const companyIds: string[] = [];

  async function countAudit(action: string): Promise<number> {
    const r = await direct.query(
      "SELECT count(*)::int AS n FROM audit_logs WHERE company_id = $1 AND action = $2",
      [A.companyId, action],
    );
    return r.rows[0].n as number;
  }

  beforeAll(async () => {
    A = await seedCompany(direct, "rptaudit");
    companyIds.push(A.companyId);

    hrUser = await seedUser(direct, A.companyId, `hr@${A.slug}.test`, "x");
    const hrRole = await seedRole(direct, A.companyId, "rptaudit-hr");
    // Cặp quyền phải khớp CỔNG THẬT của từng service (xem bảng ở docstring) — seed sai cặp thì test
    // đỏ ở gate 403 chứ không phải ở chỗ thiếu audit.
    for (const [action, resource] of [
      ["export", "leave"],
      ["view-company", "attendance"],
    ] as const) {
      // Cả hai đều NHẠY CẢM — seed đúng is_sensitive để không lật catalog dùng chung.
      const perm = await seedPermissionCatalog(direct, action, resource, true);
      await seedRolePermission(direct, hrRole, perm, "ALLOW", "Company");
    }
    await seedUserRole(direct, hrUser, hrRole, A.companyId);

    // DatabaseService phải truyền TƯỜNG MINH xuống mọi repository — bản dựng mặc định trả 0 grant
    // trong ngữ cảnh test ⇒ gate 403 và test đỏ vì SAI lý do (xem role-system-immutable.int-spec).
    const dbsvc = new DatabaseService();
    const dataScope = new DataScopeService(
      new PermissionService(new PermissionRepository(dbsvc)),
      new DataScopeRepository(dbsvc),
    );
    attSvc = new AttendanceReportService(new AttendanceReportRepository(), dbsvc, dataScope);
    leaveSvc = new LeaveReportService(new LeaveReportRepository(), dbsvc, dataScope);
  });

  afterAll(async () => {
    await cleanupTenants(direct, companyIds);
  });

  it("GET /attendance/reports (Company scope) → ghi ĐÚNG 1 audit row", async () => {
    const before = await countAudit("AttendanceReportViewed");

    await attSvc.getReport({ id: hrUser, companyId: A.companyId }, "view-company", {
      fromDate: "2026-01-01",
      toDate: "2026-01-31",
      page: 1,
      pageSize: 20,
    } as never);

    expect(await countAudit("AttendanceReportViewed")).toBe(before + 1);
  });

  it("GET /leave/reports (Company scope) → ghi ĐÚNG 1 audit row", async () => {
    const before = await countAudit("LeaveReportViewed");

    await leaveSvc.getReport({ id: hrUser, companyId: A.companyId }, {
      fromDate: "2026-01-01",
      toDate: "2026-01-31",
      page: 1,
      pageSize: 20,
    } as never);

    expect(await countAudit("LeaveReportViewed")).toBe(before + 1);
  });

  it("audit row mang actor + scope, và KHÔNG nhét PII của nhân viên vào payload", async () => {
    const r = await direct.query(
      `SELECT actor_user_id, data_scope, after FROM audit_logs
        WHERE company_id = $1 AND action IN ('AttendanceReportViewed','LeaveReportViewed')
        ORDER BY created_at DESC LIMIT 2`,
      [A.companyId],
    );
    expect(r.rows.length).toBe(2);
    for (const row of r.rows) {
      expect(row.actor_user_id).toBe(hrUser);
      expect(row.data_scope).toBe("Company");
      // Payload chỉ được mang SỐ ĐO (count + khoảng ngày + nhãn scope) — không tên/email/mã NV.
      const after = row.after as Record<string, unknown>;
      expect(Object.keys(after).sort()).toEqual(["count", "fromDate", "scope", "toDate"]);
      expect(JSON.stringify(after)).not.toMatch(/@|fullName|employeeCode/i);
    }
  });
});
