import { Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { and, eq, isNull, sql } from "drizzle-orm";
import { loadEnv } from "../config/env.schema";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { userRoles, users } from "../db/schema";
import { AuditService } from "../events/audit.service";
import { PasswordService } from "../auth/password.service";

/**
 * OperatorBootstrapService — tạo/đồng bộ MỘT tài khoản operator god-mode (platform-admin chéo tenant) từ
 * biến môi trường, chạy MỘT LẦN lúc app khởi động (OnApplicationBootstrap).
 *
 * Cơ chế (theo lựa chọn "seed lúc khởi động", KHÔNG bypass runtime):
 *   - Đặt PLATFORM_OPERATOR_EMAIL (+PASSWORD) trong file env → boot sẽ UPSERT user + gán role hệ thống
 *     `platform-admin` (id …f0). Login user này phát aud='operator' (AuthService.isOperatorTx) → control
 *     plane chéo tenant. Đổi email trong env → boot lại trỏ tài khoản MỚI.
 *   - KHÔNG sửa engine phân quyền: chỉ ghi DATA (users + user_roles) qua withTenant (RLS giữ nguyên).
 *     3 BẤT BIẾN (CLAUDE §2) không bị phá; quyền nhạy cảm vẫn đi qua cùng cổng can() như mọi user.
 *
 * Tính an toàn:
 *   - Idempotent: chạy lại không nhân bản (SELECT-then-INSERT/UPDATE theo email + (user,role,company)).
 *   - Fail-soft: DB chưa lên / công ty chưa tồn tại → log + bỏ qua, KHÔNG crash boot (mirror env: API boot
 *     được khi DB down). KHÔNG bao giờ log mật khẩu (BẤT BIẾN #3).
 *   - KHÔNG tự thu hồi operator cũ khi đổi email (tránh hạ quyền chéo tenant âm thầm). Append-only audit.
 *   - 2FA: role …f0 có requires_two_factor=true. Khi TWO_FACTOR_ENFORCEMENT_ENABLED='true' (mặc định prod),
 *     operator PHẢI enroll TOTP ở lần đăng nhập đầu trước khi chạm tài nguyên bảo vệ — đúng kỳ vọng bảo mật.
 *     Local demo: đặt TWO_FACTOR_ENFORCEMENT_ENABLED='false' để bỏ qua. Seeder KHÔNG (và không thể, RLS chặn
 *     ghi system-role) hạ cờ 2FA của role hệ thống.
 */
@Injectable()
export class OperatorBootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(OperatorBootstrapService.name);

  /** AC-0b: id role hệ thống `platform-admin` (mig 0230). Khớp AuthService.PLATFORM_ADMIN_ROLE_ID. */
  private static readonly PLATFORM_ADMIN_ROLE_ID = "00000000-0000-0000-0000-0000000000f0";

  constructor(
    private readonly dbsvc: DatabaseService,
    private readonly password: PasswordService,
    private readonly audit: AuditService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const env = loadEnv();
    const email = env.PLATFORM_OPERATOR_EMAIL;
    if (!email) {
      this.logger.debug("PLATFORM_OPERATOR_EMAIL chưa set — bỏ qua seed operator.");
      return;
    }
    // Double-guard fail-closed: superRefine đã ép PASSWORD khi có EMAIL, nhưng không tin tuyệt đối.
    const password = env.PLATFORM_OPERATOR_PASSWORD;
    if (!password) {
      this.logger.error(
        "PLATFORM_OPERATOR_EMAIL được set nhưng thiếu PLATFORM_OPERATOR_PASSWORD — KHÔNG seed operator.",
      );
      return;
    }

    try {
      await this.seedOperator(
        email,
        password,
        env.PLATFORM_OPERATOR_NAME,
        env.PLATFORM_OPERATOR_COMPANY_SLUG,
      );
    } catch (err) {
      // Fail-soft: KHÔNG crash boot. Log ERROR đầy đủ (KHÔNG mật khẩu) để bất thường quan sát được.
      this.logger.error(
        `Seed platform operator thất bại (email=${email}, company=${env.PLATFORM_OPERATOR_COMPANY_SLUG}) — app vẫn boot.`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  /** Resolve slug → companyId qua SECURITY DEFINER (lỗ RLS có kiểm soát, mirror AuthService.resolveCompanyId). */
  private async resolveCompanyId(companySlug: string): Promise<string | null> {
    const rows = await this.dbsvc.runRaw<{ id: string; status: string }>(
      sql`SELECT id, status FROM resolve_company_by_slug(${companySlug})`,
    );
    const row = rows[0];
    if (!row || row.status !== "active") return null;
    return row.id;
  }

  private async seedOperator(
    email: string,
    password: string,
    fullName: string,
    companySlug: string,
  ): Promise<void> {
    const companyId = await this.resolveCompanyId(companySlug);
    if (!companyId) {
      this.logger.warn(
        `Không tìm thấy công ty active slug="${companySlug}" — KHÔNG thể seed operator. ` +
          `Tạo công ty trước hoặc đổi PLATFORM_OPERATOR_COMPANY_SLUG.`,
      );
      return;
    }

    // Hash NGOÀI transaction (argon2 tốn CPU; không giữ kết nối DB trong lúc băm).
    const passwordHash = await this.password.hash(password);

    const result = await this.dbsvc.withTenant(companyId, (tx) =>
      this.upsertOperatorTx(tx, { email, passwordHash, fullName, companyId, companySlug }),
    );

    this.logger.log(
      `Platform operator sẵn sàng: ${email} (company=${companySlug}, role=platform-admin …f0, ` +
        `${result.userCreated ? "user MỚI" : "user đã có"}, ${result.roleGranted ? "role vừa gán" : "role đã có"}).`,
    );
  }

  /** Upsert user + ensure role …f0 + audit — chạy TRONG 1 transaction tenant (cùng commit/rollback). */
  private async upsertOperatorTx(
    tx: TenantTx,
    input: {
      email: string;
      passwordHash: string;
      fullName: string;
      companyId: string;
      companySlug: string;
    },
  ): Promise<{ userId: string; userCreated: boolean; roleGranted: boolean }> {
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
      await tx
        .update(users)
        .set({ passwordHash, fullName, status: "active", updatedAt: new Date() })
        .where(eq(users.id, userId));
    } else {
      // company_id LẤY TỪ DEFAULT current_setting('app.current_company_id') (withTenant đã set GUC).
      const [inserted] = await tx
        .insert(users)
        .values({ email, passwordHash, fullName, status: "active" })
        .returning({ id: users.id });
      // Fail-LOUD nếu INSERT không trả row (trigger/RETURNING bị chặn) — tránh TypeError mơ hồ che lỗi thật.
      if (!inserted) {
        throw new Error(`INSERT users không trả row (email=${email}) — kiểm tra trigger/RETURNING.`);
      }
      userId = inserted.id;
      userCreated = true;
    }

    // 2. Ensure role platform-admin (…f0) — idempotent theo (user, role, company).
    const roleId = OperatorBootstrapService.PLATFORM_ADMIN_ROLE_ID;
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

    let roleGranted = false;
    if (!hasRole) {
      await tx.insert(userRoles).values({ userId, roleId, companyId, grantedBy: userId });
      roleGranted = true;
    }

    // 3. Audit append-only (BẤT BIẾN #2). object_type='auth' (đã trong CHECK) — KHÔNG mật khẩu trong payload.
    await this.audit.record(tx, {
      action: "platform.operator_bootstrapped",
      objectType: "auth",
      actorUserId: userId,
      objectId: userId,
      after: {
        email,
        companySlug,
        roleId,
        userCreated,
        roleGranted,
        source: "env_bootstrap",
      },
    });

    return { userId, userCreated, roleGranted };
  }
}
