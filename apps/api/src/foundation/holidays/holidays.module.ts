import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../db/db.module";
import { PermissionModule } from "../../permission/permission.module";
import { HolidaysController } from "./holidays.controller";
import { HolidaysRepository } from "./holidays.repository";
import { HolidaysService } from "./holidays.service";

/**
 * FOUNDATION-BE-6 — HolidaysModule (self-contained). DatabaseModule = withTenant/RLS; PermissionModule
 * = PermissionService + guard stack. Exports HolidaysService để ATT/LEAVE dùng isWorkingDay/getHolidaysInRange.
 *
 * Wiring vào app: FOUNDATION-BE-9 gom module này vào FoundationModule (KHÔNG sửa app.module.ts ở WO này —
 * tránh va hot-file với BE-3 đang chạy song song).
 */
@Module({
  imports: [DatabaseModule, PermissionModule],
  controllers: [HolidaysController],
  providers: [HolidaysService, HolidaysRepository],
  exports: [HolidaysService],
})
export class HolidaysModule {}
