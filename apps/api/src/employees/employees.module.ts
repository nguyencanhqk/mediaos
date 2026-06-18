import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { DatabaseModule } from '../db/db.module';
import { PasswordService } from '../auth/password.service';
import { PermissionModule } from '../permission/permission.module';
import { SecurityPolicyModule } from '../security-policy/security-policy.module';
import { EmployeesController } from './employees.controller';
import { EmployeesRepository } from './employees.repository';
import { EmployeesService } from './employees.service';

@Module({
  imports: [
    DatabaseModule,
    // PermissionModule exports ValkeyService (import session store) + the permission stack/guards.
    PermissionModule,
    // CS-9: SecurityPolicyService cho email-domain check ở tạo tài khoản (resolveUserId).
    SecurityPolicyModule,
    MulterModule.register({ limits: { fileSize: 5 * 1024 * 1024 } }),
  ],
  controllers: [EmployeesController],
  // PasswordService is stateless (argon2) — provided locally to hash generated login passwords (F7).
  providers: [EmployeesService, EmployeesRepository, PasswordService],
  exports: [EmployeesService],
})
export class EmployeesModule {}
