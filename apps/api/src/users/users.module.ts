import { Module, OnModuleInit, forwardRef } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { DatabaseModule } from "../db/db.module";
import { PermissionModule } from "../permission/permission.module";
import { AuthModule } from "../auth/auth.module";
import { SecurityEventWriter } from "../auth/security-event-writer.service";
import { LmsSyncModule } from "../integrations/lms/lms-sync.module";
import { AdminUsersController } from "./admin-users.controller";
import { AdminUsersRepository } from "./admin-users.repository";
import { AdminUsersService } from "./admin-users.service";
import { AuthUsersController } from "./auth-users.controller";
import { AuthUsersRepository } from "./auth-users.repository";
import { AuthUsersService } from "./auth-users.service";
import { UsersController } from "./users.controller";
import { UsersService } from "./users.service";

/**
 * UsersModule — Module 2a (self-service hồ sơ) + Module 2b (ACCT-2: admin user CRUD/suspend/soft-delete)
 * + S2-AUTH-BE-3 (auth user admin: /auth/users list/create/update/lock/unlock).
 *  - AuditService đến từ EventsModule (@Global) → không import.
 *  - DatabaseModule cho withTenant. PermissionModule → PermissionGuard + PermissionService (exported).
 *  - AuthModule (forwardRef) → PasswordService cho create (hash mật khẩu, BẤT BIẾN #3). forwardRef vì
 *    AuthModule import PermissionModule (vòng tham chiếu gián tiếp khi UsersModule cũng kéo cả hai).
 *  - SecurityEventWriter (S2-AUTH-BE-8): đăng ký LÀM PROVIDER cục bộ (KHÔNG lấy từ AuthModule export) —
 *    writer stateless, chỉ phụ thuộc AuditMaskerService (@Global từ EventsModule) → tránh import-cycle với
 *    AuthModule (đã forwardRef). AuthUsersService dual-write USER_LOCKED/USER_UNLOCKED qua writer này.
 */
@Module({
  imports: [DatabaseModule, PermissionModule, forwardRef(() => AuthModule), LmsSyncModule],
  controllers: [UsersController, AdminUsersController, AuthUsersController],
  providers: [
    UsersService,
    AdminUsersService,
    AdminUsersRepository,
    AuthUsersService,
    AuthUsersRepository,
    SecurityEventWriter,
  ],
  // S4-DASH-CATALOG-2 (additive): export AuthUsersService cho USER_SUMMARY widget handler (DASH inject qua DI,
  // dùng listUsers CHỈ lấy .total — count-only). CHỈ thêm exports[], KHÔNG đổi providers/forwardRef(AuthModule)/
  // onModuleInit SecurityEventWriter fail-fast. Handler tự gate view:user TRƯỚC (listUsers KHÔNG tự gate).
  exports: [AuthUsersService],
})
export class UsersModule implements OnModuleInit {
  constructor(private readonly moduleRef: ModuleRef) {}

  /**
   * Boot-time fail-fast assertion (S2-AUTH-BE-8-FIX-2 — chống dual-write timeline degrade âm thầm).
   * `AuthUsersService` dual-write `user_security_events` (USER_LOCKED/USER_UNLOCKED) qua `securityEvents?.record`
   * — param optional (`?.`) để KHÔNG vỡ hand-built unit-spec (mock `tx` không có `.insert`). Nhược điểm: nếu
   * tương lai ai đó GỠ `SecurityEventWriter` khỏi providers, DI inject `undefined` ⇒ nhánh ghi timeline bị
   * NUỐT LẶNG (audit_logs vẫn ghi ⇒ lỗi ẩn, viewer AUTH-API-402 mất event). Khẳng định provider resolve được
   * NGAY lúc boot ⇒ app crash rõ ràng thay vì mất event runtime. KHÔNG đổi hành vi emit-site (vẫn `?.`).
   */
  onModuleInit(): void {
    try {
      this.moduleRef.get(SecurityEventWriter, { strict: true });
    } catch (err) {
      throw new Error(
        "UsersModule: SecurityEventWriter provider không resolve được lúc boot — dual-write " +
          "user_security_events (USER_LOCKED/USER_UNLOCKED) sẽ degrade âm thầm. Đăng ký lại provider trong " +
          `UsersModule.providers. (cause: ${err instanceof Error ? err.message : String(err)})`,
      );
    }
  }
}
