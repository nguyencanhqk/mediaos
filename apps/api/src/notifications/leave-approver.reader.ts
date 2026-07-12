import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";

interface DirectManagerRow {
  directManagerUserId: string | null;
}

/**
 * S4-INT-3 — LeaveApproverReader: đọc `direct_manager_id` (user_id) HIỆN TẠI của 1 nhân viên để
 * `LeaveNotiBridgeRegistrar` resolve recipient "manager" cho LEAVE_REQUEST_SUBMITTED (§19.1 — approver =
 * direct manager của subject) + nhánh manager của CANCELLED/REVOKED.
 *
 * Ưu tiên `employeeId` (cột canonical mig 0453, set ở create-path leave-request.service.ts); fallback
 * `userId` CHỈ KHI `employeeId` thiếu (hàng legacy/thiếu link employee_profiles) — mirror
 * `AttApprovalAudienceReader.resolveAdjustment` (INT-4). Đọc thẳng bảng `employee_profiles` (KHÔNG import
 * HrModule/LeaveModule — giữ acyclic).
 *
 * BẤT BIẾN #1: chạy TRONG `db.withTenant(companyId)` do caller (registrar) mở + `company_id` BIND TƯỜNG
 * MINH (defense-in-depth trên RLS+FORCE) — KHÔNG query trần. Thiếu row / NULL / manager đã rời
 * (`direct_manager_id` NULL) ⇒ trả null (fail-soft đọc) → engine log Skipped (SPEC-08 §16.4), KHÔNG throw.
 */
@Injectable()
export class LeaveApproverReader {
  async resolveManager(
    tx: TenantTx,
    companyId: string,
    employeeId: string | undefined,
    userId: string | undefined,
  ): Promise<string | null> {
    const eid = employeeId ?? null;
    const uid = userId ?? null;
    if (!eid && !uid) return null;
    const res = await tx.execute(sql`
      select direct_manager_id as "directManagerUserId"
        from employee_profiles
       where company_id = ${companyId}
         and deleted_at is null
         and (id = ${eid} or (${eid} is null and user_id = ${uid}))
       limit 1
    `);
    const row = (res.rows as unknown as DirectManagerRow[])[0];
    return row?.directManagerUserId ?? null;
  }
}
