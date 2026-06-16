import { Module } from "@nestjs/common";
import { DatabaseModule } from "../db/db.module";
import { PermissionModule } from "../permission/permission.module";
import { BreakGlassRepository } from "./break-glass.repository";
import { BreakGlassGrantService } from "./break-glass-grant.service";

/**
 * BreakGlassModule (🔒 G6-2 PR-B) — break-glass emergency access lifecycle (grant + SoD 2-người approval).
 * AuditService đến từ EventsModule (@Global). Reveal-path (ROUND 2) tái dùng PlatformAccountsService —
 * KHÔNG sao chép logic crypto/decrypt ở đây. Exports BreakGlassGrantService cho controller/reveal-path sau.
 */
@Module({
  imports: [DatabaseModule, PermissionModule],
  providers: [BreakGlassRepository, BreakGlassGrantService],
  exports: [BreakGlassGrantService],
})
export class BreakGlassModule {}
