import { Injectable } from "@nestjs/common";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";
import { users } from "../db/schema/users";
import { fromScope, identityColumns } from "../permission/identity-projection";
import { PAYROLL_PICKER_SCAN_CAP } from "./payroll-route-pairs.const";
import type { PayrollActor, PayrollPeopleMap, PayrollPersonRef } from "./payroll.types";

/**
 * S13-PAYROLL-BE-1 — `PayrollPeopleRepository`: **ĐIỂM CHIẾU DANH TÍNH DUY NHẤT** của module PAYROLL
 * (SPEC-11 §18). Mọi DTO người — tên trên bảng lương, tên trong cảnh báo `readiness`, danh bạ
 * `PAYROLL-API-034` — đi qua `namesByUserIdsTx`; **KHÔNG nơi nào khác trong `payroll/**` được `select`
 * `users.fullName`/`employee_code`** (`identity-projection` ratchet; khuôn `RecruitPeopleRepository`).
 *
 * Căn cứ chiếu = `actor.peopleVisibleCond`, tính MỘT lần/request bởi `PayrollAccessService` theo cặp
 * CỦA ROUTE (`PAYROLL_ROUTE_PAIRS`) — repository **không nhận cặp rời**, chống đường lách truyền cặp
 * sai route.
 *
 * BẤT BIẾN #1: mọi câu bind `company_id` tường minh dù RLS đã đỡ; `deleted_at IS NULL`.
 * **KHÔNG `users.email`/số điện thoại** trong bất kỳ projection nào (SPEC-11 §18).
 */
@Injectable()
export class PayrollPeopleRepository {
  private peopleGrant(actor: PayrollActor) {
    return fromScope(
      actor.peopleVisibleCond,
      "identity-gated",
      "S13-PAYROLL-BE-1 §4 — peopleVisibleCond tính 1 lần/request bởi PayrollAccessService theo cặp của route (PAYROLL_ROUTE_PAIRS); SPEC-11 §13.5 chốt kỳ lương/hồ sơ lương/thưởng-phạt CHỈ Company (sàn scope ép ở resolveActor), nên mọi grant thật đều mở tên; 0 grant / scope hẹp hơn ⇒ fail-closed users.id = actor.",
      users.id,
    );
  }

  /**
   * `userId → {displayName, employeeCode}`; user không tồn tại / khác tenant / xoá mềm KHÔNG có trong
   * map. `employeeCode` = subquery TƯƠNG QUAN (không LEFT JOIN — nhân bản hàng khi có nhiều hồ sơ lịch
   * sử), bọc CÙNG vị từ với `displayName` (mã NV là nửa danh tính).
   */
  async namesByUserIdsTx(
    tx: TenantTx,
    actor: PayrollActor,
    userIds: readonly string[],
  ): Promise<PayrollPeopleMap> {
    const ids = [...new Set(userIds)];
    const out = new Map<string, PayrollPersonRef>();
    if (ids.length === 0) return out;
    const rows = await tx
      .select({
        userId: users.id,
        ...identityColumns(this.peopleGrant(actor), { displayName: users.fullName }),
        // ⚠️ `users.id` viết CHỮ trong subquery — drizzle bỏ tên bảng cho Column trong `sql` ở
        // SELECT-list (memory `drizzle-sql-template-renders-columns-unqualified`).
        employeeCode: sql<string | null>`case when (${actor.peopleVisibleCond}) then (
          select ep.employee_code from employee_profiles ep
           where ep.user_id = users.id and ep.company_id = ${actor.companyId} and ep.deleted_at is null
           order by ep.created_at desc
           limit 1
        ) else null end`,
      })
      .from(users)
      .where(
        and(eq(users.companyId, actor.companyId), isNull(users.deletedAt), inArray(users.id, ids)),
      );
    for (const r of rows) {
      out.set(r.userId, {
        userId: r.userId,
        displayName: r.displayName ?? null,
        employeeCode: r.employeeCode ?? null,
      });
    }
    return out;
  }

  /**
   * `userId` của mọi nhân sự còn sống trong company — tập nền của `readiness` (006) và của bộ chọn
   * nhân sự (034). Trần quét `PAYROLL_PICKER_SCAN_CAP` chặn full-scan ở tenant lớn.
   *
   * GIỮ MỘT điểm chiếu: hàm này **chỉ trả id** (không chạm cột danh tính) — tên lấy ở bước hai qua
   * `namesByUserIdsTx`.
   */
  async aliveUserIdsTx(tx: TenantTx, companyId: string, limit = PAYROLL_PICKER_SCAN_CAP) {
    const rows = await tx
      .select({ userId: users.id })
      .from(users)
      .where(and(eq(users.companyId, companyId), isNull(users.deletedAt)))
      .limit(limit);
    return rows.map((r) => r.userId);
  }

  /**
   * Picker 034 — danh bạ chọn nhân sự. Bước 1 lấy id (không chạm `users` trần cho việc lọc), bước 2
   * bọc tên qua `namesByUserIdsTx`; lọc `q` áp **SAU khi đã bọc cột** (không filter trên cột danh tính
   * trần — nếu không, người không được xem tên vẫn dò được tên bằng cách thử `q`).
   */
  async pickPeopleTx(
    tx: TenantTx,
    actor: PayrollActor,
    q: string | undefined,
    limit: number,
  ): Promise<PayrollPersonRef[]> {
    const ids = await this.aliveUserIdsTx(tx, actor.companyId);
    const map = await this.namesByUserIdsTx(tx, actor, ids);
    const needle = q?.trim().toLowerCase();
    const all = [...map.values()];
    const matched = needle
      ? all.filter(
          (p) =>
            (p.displayName ?? "").toLowerCase().includes(needle) ||
            (p.employeeCode ?? "").toLowerCase().includes(needle),
        )
      : all;
    return matched
      .sort((a, b) => (a.displayName ?? "").localeCompare(b.displayName ?? "", "vi"))
      .slice(0, limit);
  }
}
