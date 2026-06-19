import { Module } from "@nestjs/common";
import { DatabaseModule } from "../db/db.module";
import { UsersController } from "./users.controller";
import { UsersService } from "./users.service";

/**
 * UsersModule — Module 2a (self-service hồ sơ). AuditService đến từ EventsModule (@Global) → không import.
 * DatabaseModule cho withTenant. Nền cho Module 2b (admin user CRUD) mở rộng sau.
 */
@Module({
  imports: [DatabaseModule],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
