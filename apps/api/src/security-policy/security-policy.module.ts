import { Module } from "@nestjs/common";
import { DatabaseModule } from "../db/db.module";
import { PermissionModule } from "../permission/permission.module";
import { SecurityPolicyController } from "./security-policy.controller";
import { SecurityPolicyEvaluator } from "./security-policy-evaluator";
import { SecurityPolicyRepository } from "./security-policy.repository";
import { SecurityPolicyService } from "./security-policy.service";

/**
 * CS-9 SecurityPolicyModule — CRUD chính sách bảo mật per-company + nguồn quyết định enforce cho auth.
 *
 * Export SecurityPolicyService + SecurityPolicyEvaluator để AuthModule (login/refresh enforce + 2FA
 * fail-stricter) và EmployeesModule (email-domain ở tạo tài khoản) dùng chung 1 nguồn quyết định.
 * EventsModule (@Global) cung cấp AuditService. PermissionModule cung cấp PermissionGuard.
 */
@Module({
  imports: [DatabaseModule, PermissionModule],
  controllers: [SecurityPolicyController],
  providers: [SecurityPolicyService, SecurityPolicyRepository, SecurityPolicyEvaluator],
  exports: [SecurityPolicyService, SecurityPolicyEvaluator],
})
export class SecurityPolicyModule {}
