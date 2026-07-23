import { Module } from "@nestjs/common";
import { PermissionModule } from "../../permission/permission.module";
import { LmsSsoController } from "./lms-sso.controller";
import { LmsSsoService } from "./lms-sso.service";
// S5-LMS-BE-3 (additive): client ĐỌC tiến độ học (GET /api/mediaos/progress) — export cho MeModule dùng lại.
import { LmsProgressClient } from "./lms-progress-client.service";

/**
 * Tích hợp LMS (fmc-app) — Giai đoạn A: cầu SSO. Không chạm DB, không migration.
 * Import PermissionModule (KHÔNG @Global) để LmsSsoController dùng được PermissionGuard/PermissionService
 * — nếu thiếu, Nest DI fail lúc boot AppModule (mọi int-spec chết). Mirror me.module/positions.module.
 */
@Module({
  imports: [PermissionModule],
  controllers: [LmsSsoController],
  providers: [LmsSsoService, LmsProgressClient],
  exports: [LmsProgressClient],
})
export class IntegrationsLmsModule {}
