import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { OperatorBootstrapService } from "./operator-bootstrap.service";
import { SuperAdminBootstrapService } from "./super-admin-bootstrap.service";

/**
 * OperatorBootstrapModule — seed 2 tài khoản đặc quyền từ env lúc khởi động:
 *   - OperatorBootstrapService: operator god-mode control-plane (role …f0, aud='operator', chéo tenant).
 *   - SuperAdminBootstrapService: super-admin sản phẩm (role company-scoped FULL quyền, aud='tenant').
 * DatabaseService (withTenant) + AuditService đến từ module @Global (DatabaseModule/EventsModule);
 * PasswordService import từ AuthModule (đã export). Cả hai tự chạy qua OnApplicationBootstrap, KHÔNG
 * có controller/endpoint (không phơi bề mặt tấn công).
 */
@Module({
  imports: [AuthModule],
  providers: [OperatorBootstrapService, SuperAdminBootstrapService],
})
export class OperatorBootstrapModule {}
