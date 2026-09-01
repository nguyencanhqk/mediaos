import { Module } from "@nestjs/common";
import { PermissionModule } from "../permission/permission.module";
import { BonusPenaltiesRepository } from "./bonus-penalties.repository";
import { BonusPenaltiesService } from "./bonus-penalties.service";
import { PayrollAccessService } from "./payroll-access.service";
import { PayrollInputsRepository } from "./payroll-inputs.repository";
import { PayrollPeopleRepository } from "./payroll-people.repository";
import { PayrollPeriodsRepository } from "./payroll-periods.repository";
import { PayrollPeriodsService } from "./payroll-periods.service";
import {
  BonusPenaltiesController,
  PayrollPeriodsController,
  PayrollPickersController,
  SalaryProfilesController,
} from "./payroll.controllers";
import { SalaryProfilesRepository } from "./salary-profiles.repository";
import { SalaryProfilesService } from "./salary-profiles.service";

/**
 * S13-PAYROLL-BE-1 — `PayrollModule` (SPEC-11 · DB-13 · API-18). WO **NỀN**: 18/35 route
 * (`001..006` · `019..028` · `034..035`); máy tính lương / duyệt / phát hành nằm ở `S13-PAYROLL-BE-2`.
 *
 * imports: `PermissionModule` (PermissionGuard + DataScopeService — guard 2 tầng §11).
 * `AuditService` đến từ `EventsModule` @Global.
 *
 * ⚠️ Module `PAYROLL` trong bảng `modules` vẫn **`is_active = false`** (FE-1 mới bật cờ) — cờ đó là
 * chỉ báo HIỂN THỊ, **không phải cổng** (memory `module-is-active-is-not-a-gate`): route ở đây sống
 * bình thường và vẫn được gác bằng `PermissionGuard` + RLS. Đừng "sửa cho nhất quán".
 *
 * KHÔNG export gì: BE-2 nằm cùng module; widget DASH của lương là việc của `S13-PAYROLL-DASH-1`.
 */
@Module({
  imports: [PermissionModule],
  controllers: [
    PayrollPeriodsController,
    SalaryProfilesController,
    BonusPenaltiesController,
    PayrollPickersController,
  ],
  providers: [
    PayrollAccessService,
    PayrollPeopleRepository,
    PayrollInputsRepository,
    PayrollPeriodsRepository,
    SalaryProfilesRepository,
    BonusPenaltiesRepository,
    PayrollPeriodsService,
    SalaryProfilesService,
    BonusPenaltiesService,
  ],
})
export class PayrollModule {}
