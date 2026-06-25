import { Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { DatabaseService } from "../db/db.service";
import { loadEnv } from "../config/env.schema";
import { PasswordService } from "../auth/password.service";
import { AuditService } from "../events/audit.service";
import { OutboxService } from "../events/outbox.service";
import {
  SuperAdminBootstrapRepository,
  type ISuperAdminBootstrapRepository,
} from "./super-admin-bootstrap.repository";

/** Tên role company-scoped chứa toàn bộ quyền catalog (aud='tenant'). */
const SUPER_ADMIN_ROLE_NAME = "super-admin";
/** Super-admin nắm toàn bộ catalog ở scope rộng nhất (RBAC §13). */
const SUPER_ADMIN_DATA_SCOPE = "System";
/**
 * Cặp KHÔNG bao giờ role-grant: reveal-secret lộ mật khẩu kênh CHỈ qua break-glass per-object (ADR-0010).
 * KHÔNG role nào — kể cả super-admin — với tới (mirror trần ở env.schema + mig 0444). Khoá theo "action:rt".
 */
const EXCLUDED_PAIRS = new Set<string>(["reveal-secret:platform-account"]);

interface SuperAdminConfig {
  email: string;
  password: string;
  fullName: string;
  companySlug: string;
}

/**
 * SuperAdminBootstrapService (S2-AUTH-SEED-1 / L2) — seed super-admin sản phẩm LÚC KHỞI ĐỘNG (runtime,
 * KHÔNG migration). Khi PLATFORM_SUPERADMIN_EMAIL set:
 *   1. resolve company theo PLATFORM_SUPERADMIN_COMPANY_SLUG; company PHẢI tồn tại & active (fail-fast).
 *   2. withTenant(companyId):
 *      a. UPSERT role 'super-admin' COMPANY-SCOPED (company_id = companyId, is_system=false) — RLS WITH
 *         CHECK cho ghi runtime (BẤT BIẾN #1, KHÔNG escape-hatch, KHÔNG migration).
 *      b. UPSERT user với password hash qua PasswordService.hash (argon2id — BẤT BIẾN #3, KHÔNG log).
 *      c. grant TOÀN BỘ catalog data_scope='System' (idempotent, tự phủ permission module mới mỗi boot)
 *         TRỪ reveal-secret:platform-account.
 *      d. gán user_role idempotent (1 user + 1 user_role).
 *      e. ghi audit (append-only) + phát permission.changed (invalidate cache cap) — CÙNG transaction.
 * VẮNG email → no-op. Boot lần 2 → idempotent (KHÔNG nhân đôi).
 *
 * ⚠️ KHÔNG đụng engine phân quyền — chỉ seed DATA. KHÔNG seed system-role company_id NULL ở migration.
 */
@Injectable()
export class SuperAdminBootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SuperAdminBootstrapService.name);

  constructor(
    private readonly dbsvc: DatabaseService,
    private readonly password: PasswordService,
    private readonly repo: SuperAdminBootstrapRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const config = this.readConfig();
    if (!config) {
      // VẮNG PLATFORM_SUPERADMIN_EMAIL → no-op (KHÔNG tạo gì).
      return;
    }

    const company = await this.resolveCompanyBySlug(config.companySlug);
    if (!company) {
      // Fail-fast: KHÔNG seed god-mode account vào tenant không tồn tại (KHÔNG log email/slug nhạy cảm thừa).
      throw new Error(
        `SuperAdminBootstrap: company slug '${config.companySlug}' không tồn tại — không thể seed super-admin.`,
      );
    }
    if (company.status !== "active") {
      throw new Error(
        `SuperAdminBootstrap: company '${config.companySlug}' không active (status=${company.status}) — bỏ seed.`,
      );
    }

    const companyId = company.id;
    const passwordHash = await this.password.hash(config.password);

    await this.dbsvc.withTenant(companyId, async (tx) => {
      const roleId = await this.repo.upsertSuperAdminRole(tx, companyId, SUPER_ADMIN_ROLE_NAME);
      const userId = await this.repo.upsertSuperAdminUser(
        tx,
        companyId,
        config.email,
        passwordHash,
        config.fullName,
      );

      const catalog = await this.repo.listAllPermissions(tx);
      let granted = 0;
      for (const perm of catalog) {
        const key = `${perm.action}:${perm.resourceType}`;
        if (EXCLUDED_PAIRS.has(key)) continue;
        await this.repo.grantPermissionWithScope(tx, roleId, perm.id, SUPER_ADMIN_DATA_SCOPE);
        granted += 1;
      }

      await this.repo.assignRole(tx, userId, roleId, companyId);

      // Audit append-only (BẤT BIẾN #2) — KHÔNG ghi password/hash (chỉ id/role/đếm). after = metadata an toàn.
      await this.audit.record(tx, {
        action: "auth.super_admin_bootstrapped",
        objectType: "user_role",
        objectId: userId,
        actorType: "System",
        after: { roleId, roleName: SUPER_ADMIN_ROLE_NAME, grantedPermissions: granted },
        resultStatus: "Success",
        dataScope: SUPER_ADMIN_DATA_SCOPE,
      });

      // Phát permission.changed sau grant → PermissionCacheInvalidator DEL cap-key của user (cùng tx, ADR-0009).
      await this.outbox.enqueue(tx, {
        eventType: "permission.changed",
        payload: { userId, companyId },
      });

      // Log AN TOÀN: chỉ companyId + đếm quyền. KHÔNG email/password/hash (BẤT BIẾN #3).
      this.logger.log(
        `super-admin seeded (company=${companyId}, role granted ${granted} catalog permissions)`,
      );
    });
  }

  /**
   * Đọc cấu hình từ env (loadEnv — fail-fast ở superRefine: EMAIL set mà thiếu PASSWORD → throw lúc load).
   * VẮNG email → null (no-op). Tách `loadConfig()` để unit-test override seam.
   */
  protected loadConfig(): NodeJS.ProcessEnv {
    return loadEnv() as unknown as NodeJS.ProcessEnv;
  }

  private readConfig(): SuperAdminConfig | null {
    const env = this.loadConfig();
    const email = env.PLATFORM_SUPERADMIN_EMAIL;
    if (!email) return null;
    const password = env.PLATFORM_SUPERADMIN_PASSWORD;
    if (!password) {
      // Double-guard: superRefine đã ép, nhưng KHÔNG seed account không mật khẩu nếu lọt (fail-fast).
      throw new Error(
        "SuperAdminBootstrap: PLATFORM_SUPERADMIN_PASSWORD bắt buộc khi PLATFORM_SUPERADMIN_EMAIL được set.",
      );
    }
    return {
      email,
      password,
      fullName: env.PLATFORM_SUPERADMIN_NAME ?? "Super Admin",
      companySlug: env.PLATFORM_SUPERADMIN_COMPANY_SLUG ?? "demo",
    };
  }

  /**
   * Resolve companySlug → { id, status } qua hàm SECURITY DEFINER resolve_company_by_slug (lỗ RLS có kiểm
   * soát, mirror AuthService.resolveCompanyId). null = không tồn tại. Tách method để unit-test override seam.
   */
  protected async resolveCompanyBySlug(
    companySlug: string,
  ): Promise<{ id: string; status: string } | null> {
    if (!db) return null;
    const res = await db.execute(
      sql`SELECT id, status FROM resolve_company_by_slug(${companySlug})`,
    );
    const row = res.rows[0] as { id: string; status: string } | undefined;
    return row ?? null;
  }
}

// Re-export interface để spec import từ repository (giữ 1 nguồn type).
export type { ISuperAdminBootstrapRepository };
