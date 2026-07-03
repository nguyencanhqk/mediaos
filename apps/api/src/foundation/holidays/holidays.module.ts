import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../db/db.module";
import { EventsModule } from "../../events/events.module";
import { PermissionModule } from "../../permission/permission.module";
import { HolidaysController } from "./holidays.controller";
import { HolidaysRepository } from "./holidays.repository";
import { HolidaysService } from "./holidays.service";

/**
 * FOUNDATION-BE-6 — HolidaysModule (self-contained). DatabaseModule = withTenant/RLS; PermissionModule
 * = PermissionService + guard stack; EventsModule = AuditService (CONFIG audit-in-tx, BẤT BIẾN #2/#3
 * mask). Exports HolidaysService để ATT/LEAVE dùng isWorkingDay/getHolidaysInRange.
 *
 * EventsModule là @Global nên AuditService có sẵn; import tường minh để self-contained (mirror
 * SettingsModule). Wiring vào app: FOUNDATION-BE-9 gom module này vào FoundationModule (KHÔNG sửa
 * app.module.ts ở WO này — tránh va hot-file).
 */
@Module({
  imports: [DatabaseModule, PermissionModule, EventsModule],
  controllers: [HolidaysController],
  providers: [HolidaysService, HolidaysRepository],
  exports: [HolidaysService],
})
export class HolidaysModule {}
