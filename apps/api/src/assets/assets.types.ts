import type { SQL } from "drizzle-orm";
import type { DataScope } from "@mediaos/contracts";

/** Actor lấy từ JWT (JwtAuthGuard → CompanyGuard). */
export interface AssetRequestUser {
  id: string;
  companyId: string;
}

/**
 * S11-ASSET-BE-1 — ngữ cảnh phạm vi ĐỌC của actor, resolve ĐÚNG MỘT LẦN mỗi request (`AssetAccessService`)
 * rồi truyền xuống repository (memory `reused-method-must-be-actor-scoped`).
 *
 * KHÔNG có vế GHI: mọi cặp ghi của ASSET chỉ tồn tại ở `@Company` (0550) — mutation chỉ cần
 * `resolveAndAssert` xác nhận grant (403), không có "neo phòng ban" như GOAL.
 */
export interface AssetActorScope {
  scope: DataScope;
  actorUserId: string;
  /** employee ACTIVE của actor (null = chưa liên kết hồ sơ ⇒ Own thấy 0 hàng). */
  actorEmployeeId: string | null;
  /** Đơn vị mình ∪ đơn vị mình làm trưởng — CHỈ khi scope = Department (Own/Team để RỖNG). */
  deptOrgUnitIds: string[];
  /** Vị từ EXISTS trên bảng `assets` (không alias). `undefined` = Company/System (không filter). */
  readScopeExists?: SQL;
  /**
   * Vị từ "được thấy danh tính người ĐANG giữ" — dựng trên `users`/`employee_profiles` của lượt Active
   * (SPEC-13 §13.6): Own = chính caller · Department = nhân viên trong đơn vị · Company = true.
   */
  holderVisibleCond: SQL;
  /** Trường tài chính chỉ trả ở Company/System (SPEC-13 §18) — cờ MASKING, không phải cổng truy cập. */
  showFinancial: boolean;
  /** Cổng "chỉ Company" (đợt kiểm kê 018/020) — TÁCH khỏi `showFinancial` để nới masking không mở nhầm cổng (gate MEDIUM). */
  isCompanyScope: boolean;
}

/** Trang → limit/offset (page/per_page đã qua Zod: page ≥ 1, per_page ∈ [1..MAX]). */
export interface PageInput {
  page: number;
  perPage: number;
}

export const toOffset = (p: PageInput): number => (p.page - 1) * p.perPage;
