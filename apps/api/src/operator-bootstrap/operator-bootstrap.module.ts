import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { OperatorBootstrapService } from "./operator-bootstrap.service";

/**
 * OperatorBootstrapModule — seed tài khoản operator god-mode (platform-admin) từ env lúc khởi động.
 * DatabaseService (withTenant) + AuditService đến từ module @Global (DatabaseModule/EventsModule);
 * PasswordService import từ AuthModule (đã export). Service tự chạy qua OnApplicationBootstrap, KHÔNG
 * có controller/endpoint (không phơi bề mặt tấn công).
 */
@Module({
  imports: [AuthModule],
  providers: [OperatorBootstrapService],
})
export class OperatorBootstrapModule {}
