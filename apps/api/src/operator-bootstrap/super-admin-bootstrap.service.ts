import { Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { and, eq, isNull, sql } from "drizzle-orm";
import { loadEnv } from "../config/env.schema";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { permissions, rolePermissions, roles, userRoles, users } from "../db/schema";
import { AuditService } from "../events/audit.service";
import { PasswordService } from "../auth/password.service";

/**
 * SuperAdminBootstrapService — tạo/đồng bộ MỘT tài khoản "super-admin sản phẩm" từ biến môi trường, chạy
 * MỘT LẦN lúc app khởi động (OnApplicationBootstrap).
 *
 * KHÁC OperatorBootstrapService:
 *   - Operator (role …f0) = control-plane CHÉO TENANT (aud='operator') — CHỈ chạm 7 controller @OperatorOnly
 *     (quản vòng đời tenant + audit + db-ops). KHÔNG gọi được API nghiệp vụ (JwtAuthGuard chặn aud).
 *   - Super-admin = NGƯỜI DÙNG THƯỜNG (aud='tenant') giữ role COMPANY-SCOPED chứa TOÀN BỘ catalog quyền →
 *     đăng nhập app sản phẩm làm được MỌI nghiệp vụ TRONG công ty đó (nhân sự, lương, KPI, tài chính…).
 *     aud='tenant' vì user KHÔNG giữ role …f0 (AuthService.isOperatorTx khoá theo …f0).
 *
 * Vì sao KHÔNG cần migration: role `super-admin` là COMPANY-SCOPED (company_id = công ty, KHÁC system role
 * company_id=NULL). RLS WITH CHECK trên roles/role_permissions/user_roles cho phép GHI khi company_id =
 * current → tạo role + grant role_permissions + gán user chạy được NGAY LÚC RUNTIME qua withTenant. Re-grant
 * toàn catalog mỗi boot ⇒ tự phủ quyền của module mới (self-heal), KHÔNG escape-hatch.
 *
 * Tính an toàn (mirror OperatorBootstrapService):
 *   - Idempotent: chạy lại không nhân bản (SELECT-then-INSERT theo email / (company,name) / (user,role,company)
 *     và ON CONFLICT DO NOTHING khi grant).
 *   - Fail-soft: DB chưa lên / công ty chưa tồn tại → log + bỏ qua, KHÔNG crash boot.
 *   - 3 BẤT BIẾN (CLAUDE §2): chỉ ghi DATA qua withTenant (RLS nguyên); KHÔNG log mật khẩu; audit append-only.
 *
 * ⚠️ TRẦN cố ý: reveal-secret:platform-account (lộ mật khẩu kênh) KHÔNG được role-grant nào với tới — engine
 * đòi per-OBJECT grant (break-glass, ADR-0010). Grant catalog vẫn chèn dòng này nhưng can() bỏ qua (inert).
 */
@Injectable()
export class SuperAdminBootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SuperAdminBootstrapService.name);

  /** Tên role company-scoped chứa toàn bộ quyền. Idempotent theo (company_id, name) non-deleted. */
  private static readonly SUPER_ADMIN_ROLE_NAME = "super-admin";

  constructor(
    private readonly dbsvc: DatabaseService,
    private readonly password: PasswordService,
    private readonly audit: AuditService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const env = loadEnv();
    const email = env.PLATFORM_SUPERADMIN_EMAIL;
    if (!email) {
      this.logger.debug("PLATFORM_SUPERADMIN_EMAIL chưa set — bỏ qua seed super-admin.");
      return;
    }
    // Double-guard fail-closed: superRefine đã ép PASSWORD khi có EMAIL, nhưng không tin tuyệt đối.
    const password = env.PLATFORM_SUPERADMIN_PASSWORD;
    if (!password) {
      this.logger.error(
        "PLATFORM_SUPERADMIN_EMAIL được set nhưng thiếu PLATFORM_SUPERADMIN_PASSWORD — KHÔNG seed super-admin.",
      );
      return;
    }

    try {
      await this.seedSuperAdmin(
        email,
        password,
        env.PLATFORM_SUPERADMIN_NAME,
        env.PLATFORM_SUPERADMIN_COMPANY_SLUG,
      );
    } catch (err) {
      // Fail-soft: KHÔNG crash boot. Log ERROR đầy đủ (KHÔNG mật khẩu) để bất thường quan sát được.
      this.logger.error(
        `Seed super-admin thất bại (email=${email}, company=${env.PLATFORM_SUPERADMIN_COMPANY_SLUG}) — app vẫn boot.`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  /** Resolve slug → companyId qua SECURITY DEFINER (lỗ RLS có kiểm soát, mirror AuthService.resolveCompanyId).
   *  Log PHÂN BIỆT not-found (sai slug) vs not-active (misconfig) để rút ngắn thời gian chẩn đoán. */
  private async resolveCompanyId(companySlug: string): Promise<string | null> {
    const rows = await this.dbsvc.runRaw<{ id: string; status: string }>(
      sql`SELECT id, status FROM resolve_company_by_slug(${companySlug})`,
    );
    const row = rows[0];
    if (!row) {
      this.logger.warn(
        `Không tìm thấy công ty slug="${companySlug}" — KHÔNG thể seed super-admin. ` +
          `Tạo công ty trước hoặc đổi PLATFORM_SUPERADMIN_COMPANY_SLUG.`,
      );
      return null;
    }
    if (row.status !== "active") {
      this.logger.error(
        `Công ty slug="${companySlug}" tồn tại nhưng status="${row.status}" (cần "active") — KHÔNG thể seed super-admin.`,
      );
      return null;
    }
    return row.id;
  }

  private async seedSuperAdmin(
    email: string,
    password: string,
    fullName: string,
    companySlug: string,
  ): Promise<void> {
    const companyId = await this.resolveCompanyId(companySlug);
    if (!companyId) return; // resolveCompanyId đã log lý do cụ thể (not-found vs not-active).

    // Hash NGOÀI transaction (argon2 tốn CPU; không giữ kết nối DB trong lúc băm).
    const passwordHash = await this.password.hash(password);

    const result = await this.dbsvc.withTenant(companyId, (tx) =>
      this.upsertSuperAdminTx(tx, { email, passwordHash, fullName, companyId, companySlug }),
    );

    this.logger.log(
      `Super-admin sẵn sàng: ${email} (company=${companySlug}, role=super-admin company-scoped, ` +
        `${result.userCreated ? "user MỚI" : "user đã có"}, ${result.roleCreated ? "role MỚI" : "role đã có"}, ` +
        `${result.roleAssigned ? "role vừa gán" : "role đã gán"}, ${result.permissionCount} quyền đảm bảo).`,
    );
  }

  /** Upsert user + ensure role company-scoped + grant toàn catalog + gán role + audit — TRONG 1 transaction. */
  private async upsertSuperAdminTx(
    tx: TenantTx,
    input: {
      email: string;
      passwordHash: string;
      fullName: string;
      companyId: string;
      companySlug: string;
    },
  ): Promise<{
    userId: string;
    userCreated: boolean;
    roleCreated: boolean;
    roleAssigned: boolean;
    permissionCount: number;
  }> {
    const { email, passwordHash, fullName, companyId, companySlug } = input;

    // 1. Upsert user (idempotent theo email, bỏ qua hàng đã xoá mềm).
    const [existing] = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.email, email), isNull(users.deletedAt)))
      .limit(1);

    let userId: string;
    let userCreated = false;
    if (existing) {
      userId = existing.id;
      // CHỈ đồng bộ passwordHash/fullName từ env (ý "đổi tài khoản qua biến env"). KHÔNG ép status='active':
      // tôn trọng admin đã đình chỉ thủ công (suspend qua RBAC/UI) — nếu force active mỗi boot thì suspend
      // bị vô hiệu (privilege-management bypass). User MỚI dưới đây vẫn tạo với status='active' (mặc định).
      await tx
        .update(users)
        .set({ passwordHash, fullName, updatedAt: new Date() })
        .where(eq(users.id, userId));
    } else {
      // company_id LẤY TỪ DEFAULT current_setting('app.current_company_id') (withTenant đã set GUC).
      const [inserted] = await tx
        .insert(users)
        .values({ email, passwordHash, fullName, status: "active" })
        .returning({ id: users.id });
      if (!inserted) {
        throw new Error(`INSERT users không trả row (email=${email}) — kiểm tra trigger/RETURNING.`);
      }
      userId = inserted.id;
      userCreated = true;
    }

    // 2. Ensure role `super-admin` COMPANY-SCOPED (idempotent theo (company_id, name) non-deleted).
    //    company_id LẤY TỪ DEFAULT current_setting (withTenant GUC) — RLS WITH CHECK chấp nhận (company role).
    const roleName = SuperAdminBootstrapService.SUPER_ADMIN_ROLE_NAME;
    const [existingRole] = await tx
      .select({ id: roles.id })
      .from(roles)
      .where(
        and(eq(roles.companyId, companyId), eq(roles.name, roleName), isNull(roles.deletedAt)),
      )
      .limit(1);

    let roleId: string;
    let roleCreated = false;
    if (existingRole) {
      roleId = existingRole.id;
    } else {
      const [insertedRole] = await tx
        .insert(roles)
        .values({
          companyId,
          name: roleName,
          description: "Full product super-admin (all permissions in this company) — env-seeded",
          isSystem: false,
          requiresTwoFactor: false,
        })
        .returning({ id: roles.id });
      if (!insertedRole) {
        throw new Error(`INSERT roles không trả row (company=${companySlug}) — kiểm tra trigger/RETURNING.`);
      }
      roleId = insertedRole.id;
      roleCreated = true;
    }

    // 3. Grant TẤT CẢ quyền catalog cho role (ALLOW). Idempotent qua ON CONFLICT DO NOTHING (unique
    //    role_id,permission_id,effect). Re-chạy mỗi boot phủ luôn quyền của module thêm sau (self-heal).
    //    Quyền nhạy cảm (is_sensitive) được grant TƯỜNG MINH exact (action,resource) ⇒ thoả sensitive-gate.
    const catalog = await tx.select({ id: permissions.id }).from(permissions);
    if (catalog.length > 0) {
      await tx
        .insert(rolePermissions)
        .values(catalog.map((p) => ({ roleId, permissionId: p.id, effect: "ALLOW" })))
        .onConflictDoNothing();
    }

    // 4. Gán role cho user (idempotent theo (user, role, company)). grantedBy=null (seed hệ thống).
    const [hasRole] = await tx
      .select({ id: userRoles.id })
      .from(userRoles)
      .where(
        and(
          eq(userRoles.userId, userId),
          eq(userRoles.roleId, roleId),
          eq(userRoles.companyId, companyId),
        ),
      )
      .limit(1);

    let roleAssigned = false;
    if (!hasRole) {
      await tx.insert(userRoles).values({ userId, roleId, companyId, grantedBy: null });
      roleAssigned = true;
    }

    // 5. Audit append-only (BẤT BIẾN #2). object_type='auth' (đã trong CHECK) — KHÔNG mật khẩu trong payload.
    await this.audit.record(tx, {
      action: "platform.superadmin_bootstrapped",
      objectType: "auth",
      actorUserId: userId,
      objectId: userId,
      after: {
        email,
        companySlug,
        roleId,
        roleName,
        userCreated,
        roleCreated,
        roleAssigned,
        permissionCount: catalog.length,
        source: "env_bootstrap",
      },
    });

    return { userId, userCreated, roleCreated, roleAssigned, permissionCount: catalog.length };
  }
}
