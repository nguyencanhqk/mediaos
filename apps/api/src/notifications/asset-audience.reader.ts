import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";

/**
 * S11-ASSET-BE-1 — AssetAudienceReader: người nhận NOTI của module ASSET (SPEC-13 §17). Mirror
 * `GoalAudienceReader`: raw SQL, KHÔNG import `AssetsModule` (giữ `notifications/**` acyclic).
 *
 *   • `holderUserIdOfAssignment` — user của nhân viên trong lượt (ASSET_ASSIGNED/ASSET_REVOKED).
 *   • `assetManagerUserIds` — user ĐANG giữ role hệ thống `asset-manager`/`company-admin` trong company
 *     (ASSET_MAINTENANCE_DUE). Vị từ ĐỦ (plan-review B10): `user_roles.deleted_at IS NULL` (thu hồi role =
 *     tombstone), `expires_at` còn hạn, `roles.company_id IS NULL AND deleted_at IS NULL`, user chưa xoá.
 *     Resolve theo ROLE chứ không theo cặp quyền — engine không có tra ngược cặp (SPEC-13 §17 ghi chú).
 *
 * BẤT BIẾN #1: chạy TRONG `withTenant` do caller mở + `company_id` bind tường minh mọi câu, kể cả bảng join.
 * Fail-soft đọc: thiếu hàng ⇒ null/[] (engine log Skipped), KHÔNG throw. Actor-exclusion để engine lo.
 */
@Injectable()
export class AssetAudienceReader {
  async holderUserIdOfAssignment(
    tx: TenantTx,
    companyId: string,
    assignmentId: string,
  ): Promise<string | null> {
    const res = await tx.execute(sql`
      select ep.user_id as "userId"
        from asset_assignments aa
        join employee_profiles ep
          on ep.id = aa.employee_id and ep.company_id = ${companyId}
       where aa.id = ${assignmentId} and aa.company_id = ${companyId}
       limit 1
    `);
    const row = (res.rows as unknown as Array<{ userId: string | null }>)[0];
    return row?.userId ?? null;
  }

  async assetManagerUserIds(tx: TenantTx, companyId: string): Promise<string[]> {
    const res = await tx.execute(sql`
      select distinct ur.user_id as "userId"
        from user_roles ur
        join roles r
          on r.id = ur.role_id
         and r.company_id is null
         and r.deleted_at is null
         and r.name in ('asset-manager', 'company-admin')
        join users u
          on u.id = ur.user_id
         and u.company_id = ${companyId}
         and u.deleted_at is null
       where ur.company_id = ${companyId}
         and ur.deleted_at is null
         and (ur.expires_at is null or ur.expires_at > now())
    `);
    return (res.rows as unknown as Array<{ userId: string | null }>)
      .map((r) => r.userId)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
  }
}
