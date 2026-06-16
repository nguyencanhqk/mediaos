import { Module } from "@nestjs/common";
import { DatabaseModule } from "../db/db.module";
import { PermissionModule } from "../permission/permission.module";
import { BreakGlassRepository } from "./break-glass.repository";
import { BreakGlassGrantService } from "./break-glass-grant.service";
import { BreakGlassController } from "./break-glass.controller";

/**
 * BreakGlassModule (🔒 G6-2 PR-B) — break-glass emergency access lifecycle (grant + SoD 2-người approval).
 * AuditService đến từ EventsModule (@Global). Reveal-path (ROUND 2) tái dùng PlatformAccountsService —
 * KHÔNG sao chép logic crypto/decrypt ở đây.
 *
 * Exports BreakGlassGrantService (controller) + BreakGlassRepository (ROUND 2: PlatformAccountsModule imports
 * this module để cổng (b) reveal đọc grant 'active' qua repo — chiều phụ thuộc một hướng, KHÔNG cycle vì
 * BreakGlassModule KHÔNG import PlatformAccountsModule).
 */
@Module({
  imports: [DatabaseModule, PermissionModule],
  controllers: [BreakGlassController],
  providers: [BreakGlassRepository, BreakGlassGrantService],
  exports: [BreakGlassGrantService, BreakGlassRepository],
})
export class BreakGlassModule {}
