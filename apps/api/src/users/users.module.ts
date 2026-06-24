import { Module } from "@nestjs/common";
import { DatabaseModule } from "../db/db.module";
import { PermissionModule } from "../permission/permission.module";
import { AdminUsersController } from "./admin-users.controller";
import { AdminUsersRepository } from "./admin-users.repository";
import { AdminUsersService } from "./admin-users.service";
import { UsersController } from "./users.controller";
import { UsersService } from "./users.service";

/**
 * UsersModule — Module 2a (self-service hồ sơ) + Module 2b (ACCT-2: admin user CRUD/suspend/soft-delete).
 *  - AuditService đến từ EventsModule (@Global) → không import.
 *  - DatabaseModule cho withTenant. PermissionModule → PermissionGuard (admin routes nhạy cảm).
 */
@Module({
  imports: [DatabaseModule, PermissionModule],
  controllers: [UsersController, AdminUsersController],
  providers: [UsersService, AdminUsersService, AdminUsersRepository],
})
export class UsersModule {}
