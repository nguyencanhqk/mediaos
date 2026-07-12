import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";

/** Recipient audience HIỆN TẠI của 1 đơn remote-work (đọc SAU commit của tx producer). */
export interface RemoteRequestAudience {
  /** user_id người tạo đơn (remote_work_requests.requested_by) — recipient approve/reject. NULL khi thiếu. */
  requestedBy: string | null;
  /** user_id người duyệt hiện tại (current_approver_user_id) — recipient cancel. NULL khi thiếu. */
  currentApproverUserId: string | null;
  /** watcher user_ids (jsonb watcher_user_ids) — recipient submit/cancel. Rỗng khi NULL/không phải mảng. */
  watcherUserIds: string[];
}

const EMPTY_REMOTE_AUDIENCE: RemoteRequestAudience = {
  requestedBy: null,
  currentApproverUserId: null,
  watcherUserIds: [],
};

interface AdjustmentManagerRow {
  directManagerUserId: string | null;
}

interface RemoteAudienceRow {
  requestedBy: string | null;
  currentApproverUserId: string | null;
  watcherUserIds: unknown;
}

function normalizeIds(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string" && x.length > 0)
    : [];
}

/**
 * S4-INT-4 — AttApprovalAudienceReader: đọc recipient HIỆN TẠI cho 2 luồng phê duyệt ATT (đơn điều chỉnh
 * công + đơn remote-work) để `AttNotiBridgeRegistrar` resolve recipient cho 4/7 mapping đọc-DB (§9.4) —
 * 3 mapping còn lại (ADJUSTMENT_APPROVED/REJECTED, REMOTE_SUBMITTED) đọc thẳng payload, KHÔNG cần reader.
 *   resolveAdjustment → direct_manager_id (user_id) của subject employee ⇒ recipient ADJUSTMENT_SUBMITTED.
 *   resolveRemote.requestedBy → recipient REMOTE_APPROVED/REJECTED (người tạo đơn).
 *   resolveRemote.currentApproverUserId ∪ watcherUserIds → recipient REMOTE_CANCELLED (approver + watchers).
 *
 * Raw SQL (mirror `task-audience.reader.ts`) — cột 0452/0457 (employee_id/current_approver_user_id) chưa
 * typed đầy đủ cho query-path này; đọc thẳng bảng thay vì gọi service AttendanceModule (giữ acyclic).
 *
 * BẤT BIẾN #1: chạy TRONG `db.withTenant(companyId)` do caller (registrar) mở + `company_id` BIND TƯỜNG
 * MINH mọi câu (defense-in-depth trên RLS+FORCE) — KHÔNG query trần. Thiếu row / NULL / rỗng ⇒ trả
 * null / [] (fail-soft đọc) → engine log Skipped (SPEC-08 §16.4), KHÔNG throw / KHÔNG delivery_log ma.
 * Actor-exclusion + filter active/same-company KHÔNG làm ở đây (engine `NotificationRecipientResolver`
 * lo — tránh lặp logic 2 nơi).
 */
@Injectable()
export class AttApprovalAudienceReader {
  /**
   * direct_manager_id (user_id) của subject employee trên 1 đơn điều chỉnh công. Ưu tiên join theo
   * employee_id (cột canonical 0452, luôn set ở create-path); fallback user_id khi employee_id NULL
   * (hàng legacy). Trả null khi thiếu đơn / thiếu manager / manager đã rời (direct_manager_id NULL).
   */
  async resolveAdjustment(
    tx: TenantTx,
    companyId: string,
    requestId: string,
  ): Promise<string | null> {
    const res = await tx.execute(sql`
      select ep.direct_manager_id as "directManagerUserId"
        from attendance_adjustment_requests r
        join employee_profiles ep
          on ep.company_id = ${companyId}
         and (ep.id = r.employee_id or (r.employee_id is null and ep.user_id = r.user_id))
       where r.id = ${requestId}
         and r.company_id = ${companyId}
         and r.deleted_at is null
         and ep.deleted_at is null
       limit 1
    `);
    const row = (res.rows as unknown as AdjustmentManagerRow[])[0];
    return row?.directManagerUserId ?? null;
  }

  /** requestedBy + currentApproverUserId + watcherUserIds của 1 đơn remote-work. Thiếu đơn ⇒ audience rỗng. */
  async resolveRemote(
    tx: TenantTx,
    companyId: string,
    requestId: string,
  ): Promise<RemoteRequestAudience> {
    const res = await tx.execute(sql`
      select requested_by as "requestedBy",
             current_approver_user_id as "currentApproverUserId",
             coalesce(watcher_user_ids, '[]'::jsonb) as "watcherUserIds"
        from remote_work_requests
       where id = ${requestId}
         and company_id = ${companyId}
         and deleted_at is null
       limit 1
    `);
    const row = (res.rows as unknown as RemoteAudienceRow[])[0];
    if (!row) return EMPTY_REMOTE_AUDIENCE;
    return {
      requestedBy: row.requestedBy ?? null,
      currentApproverUserId: row.currentApproverUserId ?? null,
      watcherUserIds: normalizeIds(row.watcherUserIds),
    };
  }
}
