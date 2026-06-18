import { Module } from "@nestjs/common";
import { DatabaseModule } from "../db/db.module";
import { PermissionModule } from "../permission/permission.module";
import { UsageController } from "./usage.controller";
import { UsageService } from "./usage.service";

/**
 * CS-7 UsageModule — tình hình sử dụng (GET /tenant/usage).
 * Guard view:usage (mig 0370, is_sensitive=false).
 */
@Module({
  imports: [DatabaseModule, PermissionModule],
  controllers: [UsageController],
  providers: [UsageService],
})
export class UsageModule {}
