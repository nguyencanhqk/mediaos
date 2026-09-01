import { ForbiddenException, Injectable } from "@nestjs/common";
import { eq, sql, type SQL } from "drizzle-orm";
import type { DataScope } from "@mediaos/contracts";
import { users } from "../db/schema/users";
import { DataScopeService } from "../permission/data-scope.service";
import { PAYROLL_ROUTE_PAIRS, type PayrollRouteKey } from "./payroll-route-pairs.const";
import type { PayrollActor, PayrollRequestUser } from "./payroll.types";

/**
 * S13-PAYROLL-BE-1 — `PayrollAccessService`: lớp phạm vi + **TẦNG GUARD THỨ HAI** của module PAYROLL
 * (SPEC-11 §11 · §13.5 · §18 · permission-matrix §9g). Mirror `RecruitAccessService`/`RoomAccessService`.
 *
 * `resolveActor(user, routeKey)` gọi ĐÚNG MỘT LẦN ở đầu mỗi method service:
 *   1. Assert cặp `PAYROLL_ROUTE_PAIRS[routeKey]` với `isSensitive` ĐÚNG CỜ (13 cặp sensitive của mig
 *      `0565` — wildcard `*:*` KHÔNG thoả cổng sensitive) ⇒ 403 khi thiếu, **độc lập với decorator**.
 *      Đây là tầng 2 của census `payroll-two-layer-guard-census`; deny ở đây để lại ZERO side-effect
 *      vì mọi service gọi nó TRƯỚC khi mở transaction.
 *   2. **SÀN SCOPE Company** cho cặp có `companyFloor` — grant hẹp hơn bị TỪ CHỐI 403, không "coi như"
 *      Company (khuôn `dash-widget-gate-needs-scope-floor`): SPEC-11 §13.5 chốt kỳ lương · dòng · hồ sơ
 *      lương · thưởng/phạt CHỈ Company, nên một lần đổi `data_scope` per-pair không được âm thầm nới.
 *   3. `peopleVisibleCond` — căn cứ THẬT cho điểm chiếu `PayrollPeopleRepository`.
 *
 * ⚠️ **KHÔNG resolve thêm cặp phụ nào để "biết caller có xem được tiền không".** PAYROLL không có DTO
 * nửa-mask (SPEC-11 §11.1): route chở tiền gác bằng đúng một cặp chở-tiền. Hỏi thêm `view-line` ở đây
 * sẽ dựng đúng cái nhánh mask-per-row mà SPEC cấm — và §14/§21 cấm luôn việc viết test cho nhánh đó,
 * nên nó sẽ là code không cổng nào chạm tới.
 */
@Injectable()
export class PayrollAccessService {
  constructor(private readonly dataScope: DataScopeService) {}

  /**
   * Route KHÔNG chở tiền — danh sách/chi tiết kỳ (`view:payroll-period` cố ý `is_sensitive=false`)
   * và picker kỳ công. Mọi route còn lại của BE-1 gác bằng cặp chở-tiền nên `canSeeMoney = true`.
   * Danh sách ĐÓNG, đọc từ đây thay vì rải `if` trong mapper.
   */
  private static readonly MONEY_FREE_ROUTES: ReadonlySet<PayrollRouteKey> =
    new Set<PayrollRouteKey>([
      "periodList",
      "periodCreate",
      "periodDetail",
      "periodUpdate",
      "pickerAttendancePeriods",
    ]);

  async resolveActor(user: PayrollRequestUser, routeKey: PayrollRouteKey): Promise<PayrollActor> {
    const p = PAYROLL_ROUTE_PAIRS[routeKey];
    // Tầng 2 — đúng cặp + đúng cờ sensitive; 403 AUTH-ERR-FORBIDDEN khi thiếu grant.
    const routeScope = await this.dataScope.resolveAndAssert(
      user.id,
      user.companyId,
      p.action,
      p.resourceType,
      { isSensitive: p.isSensitive },
    );
    if (p.companyFloor && !PayrollAccessService.isCompany(routeScope)) {
      throw new ForbiddenException(
        "AUTH-ERR-SCOPE-DENIED: cặp PAYROLL này chỉ hợp lệ ở scope Company",
      );
    }
    return {
      actorUserId: user.id,
      companyId: user.companyId,
      routeKey,
      routeScope,
      peopleVisibleCond: PayrollAccessService.peopleVisibleCond(routeScope, user.id),
      canSeeMoney: !PayrollAccessService.MONEY_FREE_ROUTES.has(routeKey),
    };
  }

  /** Company/System ⇒ `true`; hẹp hơn ⇒ fail-closed `users.id = actor` (trên `users` KHÔNG alias). */
  static peopleVisibleCond(scope: DataScope | null, actorUserId: string): SQL {
    if (PayrollAccessService.isCompany(scope)) return sql`true`;
    return eq(users.id, actorUserId);
  }

  static isCompany(scope: DataScope | null): boolean {
    return scope === "Company" || scope === "System";
  }
}
