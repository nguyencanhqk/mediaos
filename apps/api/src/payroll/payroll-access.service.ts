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
 * ⚠️ **KHÔNG resolve thêm cặp phụ nào để "biết caller có xem được TIỀN không".** PAYROLL không có DTO
 * nửa-mask (SPEC-11 §11.1): route chở tiền gác bằng đúng một cặp chở-tiền. Hỏi thêm `view-line` ở đây
 * sẽ dựng đúng cái nhánh mask-per-row mà SPEC cấm — và §14/§21 cấm luôn việc viết test cho nhánh đó,
 * nên nó sẽ là code không cổng nào chạm tới.
 *
 * 🔻 **RANH GIỚI của điều cấm trên (S15-PAYROLL-BE-1 — đọc kỹ trước khi "dọn" `canRevealTaxCode`):**
 * điều cấm là cấm **CHO TIỀN, BÊN TRONG `resolveActor`**. Nó KHÔNG cấm reveal cấp-TRƯỜNG cho một PII
 * thuộc **tài nguyên KHÁC** — SPEC-11 §15.1 hàng 037 + §18.1 A đòi đúng hành vi hai-cặp cho `taxCode`
 * (`('view','payroll-employee')` mở màn hình, `('view','salary-profile')` mở riêng ô MST). Hành vi đó
 * sống ở method RIÊNG có tên tường minh (`canRevealTaxCode`), **có sàn scope của riêng nó**, và KHÔNG
 * BAO GIỜ được gộp vào `canSeeMoney`. Gộp vào là mở lại nhánh mask-per-row tiền mà SPEC đã đóng.
 */
@Injectable()
export class PayrollAccessService {
  constructor(private readonly dataScope: DataScopeService) {}

  /**
   * Route mà **DTO của CHÍNH nó không có trường tiền nào**. Danh sách ĐÓNG, đọc từ đây thay vì rải
   * `if` trong mapper.
   *
   * ⚠️ **KHÔNG suy ngược được thành "cặp gác route này không chở tiền".** Bất biến chỉ đi MỘT CHIỀU:
   * route trong set ⇒ payload không có tiền. Từ `S15-PAYROLL-BE-1`, `periodTimesheet` (043) là ví dụ
   * ngược tường minh — nó gác bằng `('view-line','payroll-period')`, **đúng cặp chở-tiền** của
   * `periodLines`/`periodSummary`, nhưng payload của nó là **bảng công** (số ngày), không phải tiền.
   * Đọc set này như "cặp nào an toàn" là kết luận sai từ tiền đề đúng.
   *
   * Neo bằng ca **ĐẲNG THỨC** ở census (không `toContain`) — docblock không phải cổng.
   */
  static readonly MONEY_FREE_ROUTES: ReadonlySet<PayrollRouteKey> = new Set<PayrollRouteKey>([
    // v1 — danh sách/chi tiết kỳ (`view:payroll-period` cố ý `is_sensitive=false`) + picker kỳ công.
    "periodList",
    "periodCreate",
    "periodDetail",
    "periodUpdate",
    "pickerAttendancePeriods",
    // v2 track A — 8 route Nhân viên PAYROLL. Hồ sơ nhân sự · thiết lập BH/công đoàn · người phụ
    // thuộc · bảng công: PII và số NGÀY, không đồng nào. (Số tài khoản ngân hàng KHÔNG phải "tiền"
    // theo nghĩa cờ này — nó có đường mask riêng: `bankAccountLast4`, SPEC-11 §18.1 A.)
    "employeeList",
    "employeeDetail",
    "employeeSettingsGet",
    "employeeSettingsPut",
    "employeeDependentList",
    "employeeDependentCreate",
    "dependentUpdate",
    "periodTimesheet",
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

  /**
   * `PAYROLL-API-037` — có được **lộ ô `taxCode`** trong DTO nhân sự hay không (SPEC-11 §18.1 A hàng 2).
   * `taxCode` thuộc HR, PAYROLL chỉ **chiếu** nó qua cặp `('view','salary-profile')` theo PAY-DEC-016.
   *
   * Ba điều BẮT BUỘC, mỗi điều bịt một lỗ khác nhau — đừng "rút gọn" cái nào:
   *
   *  1. **`resolveOrNull`, KHÔNG `resolveAndAssert`.** Đây là kiểm MỀM cấp TRƯỜNG: thiếu cặp ⇒ **vắng
   *     khoá `taxCode`**, route vẫn **200**. Dùng bản-ném biến "không được xem MST" thành 403 CẢ route
   *     037 — siết quá tay và mâu thuẫn §15.1 hàng 037.
   *  2. **`isSensitive: true`.** Cặp `('view','salary-profile')` là 1 trong 13 cặp sensitive của mig
   *     `0565`; thiếu cờ thì wildcard `*:*` thoả được cổng và `taxCode` rò cho mọi super-grant.
   *  3. 🔴 **SÀN SCOPE Company — `isCompany(scope)`, TUYỆT ĐỐI KHÔNG `scope !== null`.** `resolveOrNull`
   *     trả scope MẠNH NHẤT và **không ép sàn nào** (`data-scope.service.ts`), trong khi
   *     `PAYROLL_ROUTE_PAIRS.salaryProfileDetail` khai `companyFloor = true` và SPEC-11 §13.5 chốt hồ
   *     sơ lương "mọi grant đều Company". Viết `!== null` ⇒ một role giữ
   *     `('view','salary-profile')`@**Department** bị **403 ở 019/021** (route sở hữu dữ liệu) nhưng
   *     **đọc được `taxCode` của BẤT KỲ ai qua 037** — ô cửa sổ rộng hơn cửa chính. Đây là BLOCKER B3
   *     của plan-review vòng 1, giữ nguyên chữ này để lượt sau không "đơn giản hoá" nó đi.
   */
  async canRevealTaxCode(user: PayrollRequestUser): Promise<boolean> {
    const scope = await this.dataScope.resolveOrNull(
      user.id,
      user.companyId,
      "view",
      "salary-profile",
      { isSensitive: true },
    );
    return PayrollAccessService.isCompany(scope);
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
