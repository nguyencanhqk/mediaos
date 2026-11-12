import type { DataScope } from "@mediaos/contracts";
import type { DataScopeService, ScopeContext } from "../permission/data-scope.service";

/** Các cột của một dòng lịch nghỉ dùng để quyết định hiện/che loại nghỉ. */
export interface TypeVisibilityRow {
  /** leave_requests.user_id — chỉ dùng cho nhánh «đơn của chính mình». */
  userId: string;
  /** employee_profiles.user_id — nguồn của phạm vi Team/Own, cùng nguồn với luồng duyệt đơn. */
  ownerUserId: string | null;
  ownerCompanyId: string;
  ownerOrgUnitId: string | null;
  ownerDirectManagerUserId: string | null;
  ownerDeletedAt: Date | null;
}

/**
 * Quy tắc hiện loại nghỉ trên lịch: đơn của chính người xem, HOẶC view:leave phủ chủ đơn, HOẶC
 * approve:leave phủ chủ đơn — cùng hàm `isEmployeeInScope` với luồng duyệt đơn (một nguồn sự thật).
 *
 * `scopes` là mảng THEO CHỈ SỐ từ `resolveManyOrNull`: [0] = view:leave, [1] = approve:leave. Đọc bằng
 * chỉ số, ô thiếu (undefined) coi như null (không phủ) — không bao giờ biến deny thành allow.
 *
 * Hồ sơ chủ đơn đã xoá mềm ⇒ không phủ (fail-closed, giống `findOwnerScopeTargetTx`) — chủ ý, không nới.
 */
export function buildTypeVisibility(
  dataScope: Pick<DataScopeService, "isEmployeeInScope">,
  scopes: readonly (DataScope | null | undefined)[],
  ctx: ScopeContext,
  actorUserId: string,
): (row: TypeVisibilityRow) => boolean {
  const viewScope = scopes[0] ?? null;
  const approveScope = scopes[1] ?? null;
  return (row) => {
    if (row.userId === actorUserId) return true;
    if (row.ownerDeletedAt != null) return false;
    const target = {
      userId: row.ownerUserId,
      companyId: row.ownerCompanyId,
      orgUnitId: row.ownerOrgUnitId,
      directManagerUserId: row.ownerDirectManagerUserId,
    };
    return (
      dataScope.isEmployeeInScope(viewScope, ctx, target) ||
      dataScope.isEmployeeInScope(approveScope, ctx, target)
    );
  };
}
