import { Module, forwardRef } from "@nestjs/common";
import { DatabaseModule } from "../db/db.module";
import { PermissionModule } from "../permission/permission.module";
import { AuthModule } from "../auth/auth.module";
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
 */
@Module({
  imports: [DatabaseModule, PermissionModule, forwardRef(() => AuthModule)],
  controllers: [UsersController, AdminUsersController, AuthUsersController],
  providers: [
    UsersService,
    AdminUsersService,
    AdminUsersRepository,
    AuthUsersService,
    AuthUsersRepository,
  ],
})
export class UsersModule {}
