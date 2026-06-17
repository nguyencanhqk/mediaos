import { Module } from "@nestjs/common";
import { DatabaseModule } from "../db/db.module";
import { AuthModule } from "../auth/auth.module";
import { PermissionModule } from "../permission/permission.module";
import { ApiKeyRepository } from "./api-keys.repository";
import { ApiKeysService } from "./api-keys.service";
import { ApiKeysController } from "./api-keys.controller";

/**
 * ApiKeysModule (AC-5 🔒) — CRUD self-service PAT. ApiKeyRepository hiện thực ApiKeyAuthLookup → export để
 * ApiKeyAuthGuard (đăng ký GLOBAL ở app.module qua APP_GUARD) inject được (auth-path).
 *
 * AuditService đến từ EventsModule (@Global). TokenService từ AuthModule. PermissionService từ PermissionModule
 * (dùng userGrantsPermissionIds validate scope ⊆ grant user lúc tạo).
 */
@Module({
  imports: [DatabaseModule, AuthModule, PermissionModule],
  controllers: [ApiKeysController],
  providers: [ApiKeyRepository, ApiKeysService],
  exports: [ApiKeyRepository],
})
export class ApiKeysModule {}
