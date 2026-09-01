import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";
import { PAYROLL_ROUTE_PAIRS } from "./payroll-route-pairs.const";

/**
 * S13-PAYROLL-BE-2 — `PayrollApproverReader`: **MỘT bộ giải "người duyệt bảng lương hợp lệ", HAI caller**
 * (plan §D4 · mig `0566`):
 *   1. cổng `PAYROLL-ERR-017` ở `submit` — rỗng ⇒ 422, kỳ **ở nguyên `Calculated`** (công ty một-người-duyệt
 *      không kẹt vĩnh viễn ở `Reviewing` — SPEC-11 §13.1);
 *   2. danh sách người nhận NOTI-020, nhét vào payload outbox NGAY tại `submit`.
 *
 * Hai bộ giải lệch nhau đẻ đúng cái thất bại mà `017` sinh ra để chặn: cổng nói "có người duyệt" rồi
 * thông báo đi tới một tập khác (hoặc rỗng). Vì thế reader này nằm ở `payroll/` (nơi `submit` sống) và
 * kết quả của nó **đi theo payload**, KHÔNG resolve lại lúc giao (khuôn `recruit.job_assigned`).
 *
 * ── Mirror `decideCan` (permission.decide.ts) cho cặp `('approve','payroll-period')` ──
 * Cặp này `is_sensitive = true` (seed mig `0565`) và route KHÔNG khai `requiresReauth`, nên:
 *  · **DENY thắng tất cả** — kể cả DENY qua wildcard (`matchesCompanyGrant` khớp `*`);
 *  · ALLOW phải là **exact, KHÔNG wildcard** (cổng sensitive: `*:*` không thoả) ⇒ super-admin chỉ có
 *    `*:*` **đúng ra là không duyệt được**, và bị loại ở đây là ĐÚNG, không phải bỏ sót;
 *  · `needsObjectGrant = objectGrantRequired ?? (isSensitive && requiresReauth)` = `false` ⇒ KHÔNG xét
 *    `object_permissions` (SPEC-11 §13.1);
 *  · `user_roles` phải còn sống (`deleted_at IS NULL`) và chưa hết hạn (`expires_at`).
 *
 * Thêm **SÀN SCOPE Company** (`PayrollAccessService`, SPEC-11 §13.5): grant hẹp hơn Company bị
 * `resolveActor` từ chối 403, nên tính người đó là "duyệt được" thì `017` xanh giả rồi họ 403 ở `approve`.
 *
 * BẤT BIẾN #1: chạy TRONG `withTenant` do caller mở + bind `company_id` TƯỜNG MINH (defense-in-depth).
 */
@Injectable()
export class PayrollApproverReader {
  private static readonly PAIR = PAYROLL_ROUTE_PAIRS.periodApprove;

  /**
   * `user_id` của mọi người duyệt hợp lệ, **loại `excludeUserId`** (four-eyes: người gửi duyệt không
   * tự duyệt được nên không được tính là "đã có người duyệt").
   *
   * `ORDER BY u.id` cho thứ tự ổn định — payload outbox so được bằng đẳng thức trong test.
   */
  async eligibleApproverIdsTx(
    tx: TenantTx,
    companyId: string,
    excludeUserId: string,
  ): Promise<string[]> {
    const { action, resourceType } = PayrollApproverReader.PAIR;
    const res = await tx.execute<{ user_id: string }>(sql`
      with candidate as (
        select ur.user_id, rp.effect, rp.data_scope, p.action, p.resource_type
          from user_roles ur
          join roles r on r.id = ur.role_id and r.deleted_at is null
                      and (r.company_id = ${companyId}::uuid or r.company_id is null)
          join role_permissions rp on rp.role_id = r.id
          join permissions p on p.id = rp.permission_id
          join users u on u.id = ur.user_id
         where ur.company_id = ${companyId}::uuid
           and ur.deleted_at is null
           and (ur.expires_at is null or ur.expires_at > now())
           and u.company_id = ${companyId}::uuid
           and u.deleted_at is null
           and u.id <> ${excludeUserId}::uuid
           -- Khớp cặp THEO KIỂU CỦA ENGINE: wildcard tính cho vế DENY, không tính cho vế ALLOW.
           and (p.action = ${action} or p.action = '*')
           and (p.resource_type = ${resourceType} or p.resource_type = '*')
      ),
      denied as (
        select distinct user_id from candidate where effect = 'DENY'
      )
      select distinct c.user_id
        from candidate c
       where c.effect = 'ALLOW'
         -- Cổng sensitive: exact ALLOW, wildcard KHÔNG thoả (permission.decide.ts).
         and c.action = ${action}
         and c.resource_type = ${resourceType}
         -- SÀN SCOPE Company — grant hẹp hơn sẽ 403 ở route approve (SPEC-11 §13.5).
         and c.data_scope in ('Company', 'System')
         and not exists (select 1 from denied d where d.user_id = c.user_id)
       order by c.user_id
    `);
    const list = (res as unknown as { rows?: unknown[] }).rows ?? (res as unknown as unknown[]);
    return (list as { user_id: string }[]).map((r) => r.user_id);
  }
}
