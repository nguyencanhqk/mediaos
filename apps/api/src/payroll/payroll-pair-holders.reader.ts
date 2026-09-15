import { Injectable } from "@nestjs/common";
import { sql, type SQL } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";
import { PAYROLL_ROUTE_PAIRS, type PayrollRouteKey } from "./payroll-route-pairs.const";

/**
 * S15-PAYROLL-BE-4 (plan D-8) — `PayrollPairHoldersReader`: «ai trong công ty giữ cặp CỦA ROUTE X ở scope Company»,
 * tham số hoá theo `routeKey`. Cùng cách khớp `decideCan` (permission.decide.ts): **DENY thắng tất cả** (kể cả DENY qua
 * wildcard) · ALLOW phải **exact, KHÔNG wildcard** (mọi cặp track C `is_sensitive = true` — mig 0571) · KHÔNG xét
 * `object_permissions` · `user_roles` sống, chưa hết hạn · **SÀN SCOPE Company** (SPEC-11 §13.5 — grant hẹp hơn sẽ 403 ở
 * route, tính họ là «đủ» là xanh giả).
 *
 * Ba caller, ba cổng:
 *  · 060 — người nhận NOTI-024 = holders(`advanceApprove`) − actor (rỗng ⇒ KHÔNG enqueue + warning, không 422);
 *  · 067 — tiền-kiểm C3: holders(`batchComplete`) − actor rỗng ⇒ 422 017 `no-eligible-completer` (four-eyes 072 sẽ
 *    không bao giờ thoả — fail-fast lúc LẬP, không kẹt kỳ `Published`);
 *  · 072 — người nhận NOTI-027 = holders(`batchList`) − actor.
 * Kết quả ĐI THEO PAYLOAD outbox, không resolve lại lúc giao (hai bộ giải lệch nhau đẻ đúng lỗi mà cổng sinh ra để chặn).
 *
 * S15-PAYROLL-BE-4B (security M3): câu SQL tách ra `pairHoldersQuery` và `PayrollApproverReader` (017 ở `submit`, NOTI-020)
 * dùng CHUNG — MỘT vế `users.status = 'active'` cho cả bốn cổng. Trước đó holder bị đình chỉ vẫn được đếm ⇒ C3/017 xanh
 * giả (không ai hoàn tất/duyệt được) và NOTI 020/024/027 gửi vào tài khoản không đăng nhập được.
 * BẤT BIẾN #1: chạy TRONG `withTenant` do caller mở + bind `company_id` TƯỜNG MINH.
 */
@Injectable()
export class PayrollPairHoldersReader {
  /** `user_id` mọi người giữ cặp của `routeKey` @Company, loại `excludeUserId`; `ORDER BY` ổn định để so đẳng thức. */
  async holdersTx(
    tx: TenantTx,
    companyId: string,
    routeKey: PayrollRouteKey,
    excludeUserId: string,
  ): Promise<string[]> {
    const res = await tx.execute<{ user_id: string }>(
      pairHoldersQuery(companyId, PAYROLL_ROUTE_PAIRS[routeKey], excludeUserId),
    );
    return holderRowsToIds(res);
  }
}

/**
 * MỘT câu SQL «người giữ cặp (action, resourceType) @Company, hoạt động, khác `excludeUserId`» cho cả hai reader.
 * Vế tài khoản = allow-list `users.status = 'active'` — khớp cổng đăng nhập (`auth.service.ts` `isAuthorizedStatus`, áp ở
 * login/refresh/2FA); CHECK thật có BỐN giá trị `active|invited|suspended|locked` (mig 0002 + 0450) nên allow-list là bắt buộc:
 * `invited`/`locked`/trạng thái mới tự rớt. Cộng `deleted_at IS NULL`.
 *
 * CỐ Ý KHÔNG soi (security-reviewer BE-4B): `locked_at` (đi CẶP với `status='locked'` — `auth-users.repository` set/clear
 * cả hai; WO auto-lock theo ngưỡng sau này PHẢI đổi `status`, không chỉ `locked_at`) · `must_change_password` và
 * `require_two_factor` (cổng PHIÊN — người đó vẫn duyệt/hoàn tất được sau khi qua bước) · `companies.status` (login/refresh đã
 * chặn công ty non-active — actor gọi được route nghĩa là công ty đang active).
 */
export function pairHoldersQuery(
  companyId: string,
  pair: { action: string; resourceType: string },
  excludeUserId: string,
): SQL {
  const { action, resourceType } = pair;
  return sql`
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
           -- BE-4B: tài khoản phải HOẠT ĐỘNG (allow-list như cổng đăng nhập) — đình chỉ thì không duyệt/hoàn tất/nhận NOTI.
           and u.status = 'active'
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
         -- SÀN SCOPE Company — grant hẹp hơn sẽ 403 ở route (SPEC-11 §13.5).
         and c.data_scope in ('Company', 'System')
         and not exists (select 1 from denied d where d.user_id = c.user_id)
       order by c.user_id
    `;
}

/** Kết quả `tx.execute` (node-postgres `{rows}` hoặc mảng thô) → danh sách `user_id`. */
export function holderRowsToIds(res: unknown): string[] {
  const list = (res as { rows?: unknown[] }).rows ?? (res as unknown[]);
  return (list as { user_id: string }[]).map((r) => r.user_id);
}
