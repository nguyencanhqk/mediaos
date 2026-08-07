import { Module } from "@nestjs/common";
import { PermissionModule } from "../../permission/permission.module";
import { SocialSsoController } from "./social-sso.controller";
import { SocialSsoService } from "./social-sso.service";

/**
 * Tích hợp app vệ tinh SOCIAL (fbpost) — cầu SSO. Không chạm DB nghiệp vụ, không migration riêng
 * (quyền + audit object_type nằm ở 0544/0545).
 *
 * Import PermissionModule (KHÔNG @Global) để SocialSsoController dùng được PermissionGuard —
 * thiếu là Nest DI vỡ lúc boot AppModule và KÉO THEO cả trăm int-spec đỏ dây chuyền
 * (memory systemjobhandler-optional-dbw-di). Mirror IntegrationsLmsModule.
 *
 * Hàng rào R2 của DECISIONS-08: đây là MỘT trong đúng hai điểm wave S9 được chạm vào apps/api.
 */
@Module({
  imports: [PermissionModule],
  controllers: [SocialSsoController],
  providers: [SocialSsoService],
})
export class IntegrationsSocialModule {}
