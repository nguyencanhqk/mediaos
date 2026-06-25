import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";

/**
 * Một entry catalog permission (id + cặp action/resourceType + cờ nhạy cảm). Dùng để super-admin grant
 * TOÀN BỘ catalog (tự phủ permission module mới mỗi boot) — TRỪ break-glass per-object.
 */
export interface CatalogPermission {
  id: string;
  action: string;
  resourceType: string;
  isSensitive: boolean;
}

/**
 * Hợp đồng write-side cho SuperAdminBootstrapService. Mọi method nhận `tx` (TenantTx) từ service →
 * chạy BÊN TRONG withTenant(companyId) (RLS WITH CHECK ép company_id = current, BẤT BIẾN #1).
 * Tách interface để unit-test service bằng fake repo (không chạm DB).
 */
export interface ISuperAdminBootstrapRepository {
  upsertSuperAdminRole(tx: TenantTx, companyId: string, name: string): Promise<string>;
  upsertSuperAdminUser(
    tx: TenantTx,
    companyId: string,
    email: string,
    passwordHash: string,
    fullName: string,
  ): Promise<string>;
  listAllPermissions(tx: TenantTx): Promise<CatalogPermission[]>;
  grantPermissionWithScope(
    tx: TenantTx,
    roleId: string,
    permissionId: string,
    dataScope: string,
  ): Promise<void>;
  assignRole(tx: TenantTx, userId: string, roleId: string, companyId: string): Promise<void>;
}

/**
 * SuperAdminBootstrapRepository — write-side cho seed super-admin lúc khởi động (S2-AUTH-SEED-1 / L2).
 *
 * ⚠️ BẤT BIẾN:
 *   #1 (tenant): role 'super-admin' COMPANY-SCOPED (company_id = companyId, KHÔNG NULL) → RLS WITH CHECK
 *      `roles_tenant_isolation` cho ghi runtime (KHÔNG cần migration, KHÔNG escape-hatch). is_system=false.
 *   #2 (append-only): `role_permissions` app role KHÔNG có UPDATE (mig 0005) — đổi data_scope = DELETE đúng
 *      bộ (role_id, permission_id, 'ALLOW') có scope SAI + INSERT lại (mirror mig 0444). KHÔNG blanket DELETE.
 *   #3 (no secret plaintext): passwordHash nhận TỪ PasswordService (argon2id) — repo CHỈ persist, KHÔNG hash,
 *      KHÔNG log. UPSERT user qua ON CONFLICT(company_id, normalized_email) DO UPDATE (idempotent boot lần 2).
 *
 * Idempotent bộ-ba (role, permission, scope): boot lần 2 → DELETE-wrong-scope không khớp + INSERT trúng
 * ON CONFLICT(role_id,permission_id,effect) DO NOTHING = no-op.
 */
@Injectable()
export class SuperAdminBootstrapRepository implements ISuperAdminBootstrapRepository {
  /**
   * UPSERT role company-scoped 'super-admin'. ON CONFLICT khớp partial unique index
   * `roles_company_name_active_uq (company_id, name) WHERE deleted_at IS NULL` → boot lần 2 trả role cũ.
   * KHÔNG đụng description khi đã có (giữ ổn định). RETURNING id qua CTE để lấy id dù INSERT hay CONFLICT.
   */
  async upsertSuperAdminRole(tx: TenantTx, companyId: string, name: string): Promise<string> {
    const res = await tx.execute(sql`
      WITH ins AS (
        INSERT INTO roles (company_id, name, description, is_system, requires_two_factor)
        VALUES (
          ${companyId}, ${name},
          'Super Admin (company-scoped): toàn bộ catalog quyền trong công ty (seed runtime, S2-AUTH-SEED-1)',
          false, false
        )
        ON CONFLICT (company_id, name) WHERE deleted_at IS NULL DO NOTHING
        RETURNING id
      )
      SELECT id FROM ins
      UNION ALL
      SELECT id FROM roles
        WHERE company_id = ${companyId} AND name = ${name} AND deleted_at IS NULL
      LIMIT 1
    `);
    const row = res.rows[0] as { id: string } | undefined;
    if (!row) {
      throw new Error("SuperAdminBootstrap: không resolve được role_id sau upsert (RLS chặn?)");
    }
    return row.id;
  }

  /**
   * UPSERT user super-admin. Khoá idempotency = (company_id, normalized_email) — normalized_email là
   * GENERATED STORED `lower(email)` ⇒ unique theo cặp đó (mig users). Boot lần 2 cập nhật password_hash +
   * full_name (xoay mật khẩu theo env), giữ id ổn định. KHÔNG bao giờ ghi/đụng plaintext (BẤT BIẾN #3).
   */
  async upsertSuperAdminUser(
    tx: TenantTx,
    companyId: string,
    email: string,
    passwordHash: string,
    fullName: string,
  ): Promise<string> {
    const res = await tx.execute(sql`
      INSERT INTO users (company_id, email, password_hash, full_name, status)
      VALUES (${companyId}, ${email}, ${passwordHash}, ${fullName}, 'active')
      ON CONFLICT (company_id, normalized_email) WHERE deleted_at IS NULL DO UPDATE
        SET password_hash = EXCLUDED.password_hash,
            full_name     = EXCLUDED.full_name,
            status        = 'active',
            updated_at    = now()
      RETURNING id
    `);
    const row = res.rows[0] as { id: string } | undefined;
    if (!row) {
      throw new Error("SuperAdminBootstrap: không resolve được user_id sau upsert (RLS chặn?)");
    }
    return row.id;
  }

  /**
   * Toàn bộ catalog permission (GLOBAL no-RLS). Tự phủ permission module mới mỗi boot → super-admin luôn
   * đủ quyền. Service tự lọc bỏ break-glass (reveal-secret:platform-account) TRƯỚC grant.
   */
  async listAllPermissions(tx: TenantTx): Promise<CatalogPermission[]> {
    const res = await tx.execute(sql`
      SELECT id, action, resource_type AS "resourceType", is_sensitive AS "isSensitive"
        FROM permissions
    `);
    return res.rows as unknown as CatalogPermission[];
  }

  /**
   * Grant 1 cặp (role, permission) effect ALLOW với data_scope chỉ định (super-admin = 'System'). Idempotent
   * bộ-ba: DELETE đúng bộ (role_id, permission_id, 'ALLOW') có data_scope KHÁC target (per-pair, KHÔNG
   * blanket — BẤT BIẾN #2) rồi INSERT ON CONFLICT(role_id,permission_id,effect) DO NOTHING. App role KHÔNG có
   * UPDATE trên role_permissions ⇒ đổi scope BẮT BUỘC qua DELETE+INSERT (mig 0005/0444).
   */
  async grantPermissionWithScope(
    tx: TenantTx,
    roleId: string,
    permissionId: string,
    dataScope: string,
  ): Promise<void> {
    await tx.execute(sql`
      DELETE FROM role_permissions
       WHERE role_id = ${roleId}
         AND permission_id = ${permissionId}
         AND effect = 'ALLOW'
         AND data_scope <> ${dataScope}
    `);
    await tx.execute(sql`
      INSERT INTO role_permissions (role_id, permission_id, effect, data_scope)
      VALUES (${roleId}, ${permissionId}, 'ALLOW', ${dataScope})
      ON CONFLICT (role_id, permission_id, effect) DO NOTHING
    `);
  }

  /**
   * Gán role cho user (1 user_role). Idempotent qua ON CONFLICT(user_id, role_id, company_id) DO NOTHING
   * (constraint user_roles_uq) → boot lần 2 KHÔNG nhân đôi.
   */
  async assignRole(tx: TenantTx, userId: string, roleId: string, companyId: string): Promise<void> {
    await tx.execute(sql`
      INSERT INTO user_roles (user_id, role_id, company_id)
      VALUES (${userId}, ${roleId}, ${companyId})
      ON CONFLICT (user_id, role_id, company_id) DO NOTHING
    `);
  }
}
