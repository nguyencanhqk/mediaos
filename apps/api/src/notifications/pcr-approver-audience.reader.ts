import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";

interface ApproverRow {
  userId: string;
}

interface RequesterRow {
  userId: string | null;
}

/**
 * Recipient cho 3 mapping HR profile-change-request (SPEC-08 §15).
 *
 * `resolveApprovers` — ai được nhận HR_PROFILE_CHANGE_SUBMITTED. KHÔNG hard-code role "hr"/"company-admin":
 * đọc theo CẶP QUYỀN THẬT `approve:profile-change-request` (cùng cặp controller gate), nên role mới được
 * cấp quyền duyệt sẽ tự vào danh sách, và role bị thu quyền tự rơi ra — không phải sửa code.
 *
 * `resolveRequesterUserId` — người gửi yêu cầu, nhận APPROVED/REJECTED. Đọc từ bảng thay vì tin payload:
 * producer có gửi kèm userId, nhưng đọc lại đảm bảo đúng chủ hồ sơ kể cả khi payload thiếu/lệch.
 *
 * BẤT BIẾN #1: chạy TRONG `db.withTenant(companyId)` do registrar mở + bind `company_id` TƯỜNG MINH mọi
 * câu (defense-in-depth trên RLS+FORCE). Thiếu row ⇒ trả [] / null (fail-soft đọc) → engine log Skipped,
 * KHÔNG throw. Actor-exclusion + lọc user active để engine `NotificationRecipientResolver` lo (không lặp
 * logic 2 nơi) — mirror `AttApprovalAudienceReader`.
 */
@Injectable()
export class PcrApproverAudienceReader {
  /** user_id của mọi người đang có cặp `approve:profile-change-request` trong công ty (đã bỏ trùng). */
  async resolveApprovers(tx: TenantTx, companyId: string): Promise<string[]> {
    const res = await tx.execute(sql`
      select distinct ur.user_id as "userId"
        from user_roles ur
        join role_permissions rp
          on rp.role_id = ur.role_id
         and rp.company_id = ${companyId}
        join permissions p
          on p.id = rp.permission_id
         and p.action = 'approve'
         and p.resource_type = 'profile-change-request'
        join users u
          on u.id = ur.user_id
         and u.company_id = ${companyId}
       where ur.company_id = ${companyId}
         and ur.deleted_at is null
         and (ur.expires_at is null or ur.expires_at > now())
         and u.deleted_at is null
         and u.status = 'Active'
    `);
    return (res.rows as unknown as ApproverRow[])
      .map((r) => r.userId)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
  }

  /** user_id chủ hồ sơ của 1 yêu cầu. NULL khi yêu cầu không còn / hồ sơ chưa gắn tài khoản. */
  async resolveRequesterUserId(
    tx: TenantTx,
    companyId: string,
    requestId: string,
  ): Promise<string | null> {
    const res = await tx.execute(sql`
      select ep.user_id as "userId"
        from profile_change_requests r
        join employee_profiles ep
          on ep.id = r.employee_id
         and ep.company_id = ${companyId}
       where r.id = ${requestId}
         and r.company_id = ${companyId}
         and ep.deleted_at is null
       limit 1
    `);
    return (res.rows as unknown as RequesterRow[])[0]?.userId ?? null;
  }
}
