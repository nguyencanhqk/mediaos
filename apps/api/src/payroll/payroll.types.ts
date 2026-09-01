import type { SQL } from "drizzle-orm";
import type { DataScope } from "@mediaos/contracts";
import type { PayrollRouteKey } from "./payroll-route-pairs.const";

/** Actor lấy từ JWT (JwtAuthGuard → CompanyGuard). */
export interface PayrollRequestUser {
  id: string;
  companyId: string;
}

/**
 * S13-PAYROLL-BE-1 — ngữ cảnh phạm vi của actor, resolve ĐÚNG MỘT LẦN mỗi request ở
 * `PayrollAccessService.resolveActor(user, routeKey)` rồi truyền xuống repository/mapper
 * (memory `reused-method-must-be-actor-scoped` — khuôn `RecruitActor`).
 *
 *   • Tầng guard THỨ HAI nằm trong `resolveActor`: assert cặp `PAYROLL_ROUTE_PAIRS[routeKey]` kèm
 *     `isSensitive` ĐÚNG CỜ — 403 độc lập với decorator route; deny ở đây để lại ZERO side-effect.
 *   • SÀN SCOPE Company cho mọi cặp `companyFloor` (SPEC-11 §13.5).
 *   • `peopleVisibleCond` — vị từ trên `users` cho `identityColumns`, suy từ scope của CHÍNH cặp route.
 *   • `canSeeMoney` — cờ masking tính MỘT lần: trường tiền chỉ CÓ MẶT trong DTO khi cờ này bật
 *     (biểu hiện của mask là **VẮNG KHOÁ**, không `null`/`0` — SPEC-11 §18).
 */
export interface PayrollActor {
  actorUserId: string;
  companyId: string;
  routeKey: PayrollRouteKey;
  /** Scope của cặp route đang phục vụ (đã assert ≠ null + qua sàn ở tầng 2). */
  routeScope: DataScope;
  /** Vị từ trên `users` (KHÔNG alias) cho `identityColumns`. */
  peopleVisibleCond: SQL;
  /**
   * Cặp chở-tiền của CHÍNH route này có được cấp không.
   *
   * PAYROLL **không có DTO nửa-mask** (SPEC-11 §11.1): mọi route chở tiền gác bằng đúng một cặp
   * chở-tiền, nên trên các route đó cờ này LUÔN `true` (đã qua tầng 2). Cờ tồn tại để mapper không
   * phải suy lại từ `routeKey`, và để route KHÔNG chở tiền (`001`/`003` danh sách kỳ) ép được
   * `false` — kể cả khi caller tình cờ có `view-line`.
   */
  canSeeMoney: boolean;
}

/** Trang `page`/`per_page` → offset (đã qua Zod). */
export const payrollOffset = (page: number, perPage: number): number => (page - 1) * perPage;

/** Người sau khi chiếu danh tính (map `userId → …`). */
export interface PayrollPersonRef {
  userId: string;
  displayName: string | null;
  employeeCode: string | null;
}
export type PayrollPeopleMap = ReadonlyMap<string, PayrollPersonRef>;

/**
 * Năm đại lượng đầu vào của một nhân sự trong kỳ (SPEC-11 §13.4) — **tính hết ở SQL**, JS chỉ chuyển
 * chuỗi `numeric` sang `number` ở biên DTO. BE-2 tiêu thụ nguyên vẹn cấu trúc này.
 */
export interface PayrollUserInputs {
  userId: string;
  /** Hằng CHUNG cả kỳ (không per-người) — lặp lại mỗi hàng cho tiện tiêu thụ. */
  workDays: number;
  /** THẬP PHÂN (numeric(8,2) ở SQL) — nghỉ nửa buổi/theo giờ ⇒ 0.5 / 0.38. KHÔNG ép về int. */
  presentDays: number;
  paidLeaveDays: number;
  unpaidLeaveDays: number;
  lateMinutes: number;
}

/** Nguồn của các con số — nhét vào `input_snapshot_json` để số liệu «giải thích được» sau nhiều tháng. */
export interface PayrollInputSnapshotMeta {
  /** Mảng ISO-dow đã dùng, đọc từ `companies.working_days_json -> 'days'`. */
  workingDays: number[];
  /** Ngày lễ đã TRỪ khỏi mẫu số (đủ 4 vị từ SPEC-11 §13.4). */
  holidaysExcluded: string[];
  /** Luật đếm ngày công — quyết định OWNER 2026-09-01, ghi nguyên văn để đối chiếu về sau. */
  presentDaysRule: string;
  periodMonth: string;
  workDays: number;
}
