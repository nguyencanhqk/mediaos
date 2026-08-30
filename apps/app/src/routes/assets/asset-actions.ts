/**
 * S11-ASSET-FE-1 — suy nút hành động của màn chi tiết (ASSET-SCREEN-002) từ **FSM ∩ quyền**.
 *
 * SPEC-13 §14 buộc: "hành động bị FSM chặn ⇒ nút **không hiện** thay vì hiện rồi 409". Hai vế phải
 * cùng đúng — thiếu vế FSM thì người đủ quyền vẫn bấm được nút chắc chắn hỏng; thiếu vế quyền thì lộ
 * bề mặt thao tác cho người không được phép (backend vẫn chặn, nhưng UI nói dối).
 *
 * Hàm thuần, KHÔNG đụng react — để spec neo đủ 5 trạng thái × 8 hành động mà không dựng DOM.
 *
 * ⚠️ Vế «Thanh lý» KHÔNG suy từ `status`: ASSET-ERR-008 kiểm theo **sự tồn tại lượt cấp phát Active**,
 * bất kể `status` là `Assigned` hay `Under Maintenance` (tài sản đang bảo trì vẫn có thể còn người
 * giữ — SPEC-13 §13.1). Dùng `status !== "Assigned"` ở đây sẽ hiện nút Thanh lý cho một tài sản
 * `Under Maintenance` còn người giữ, và người dùng ăn 409 đúng cái mà §14 cấm.
 */
import type { AssetLifecycleStatusDto } from "@mediaos/contracts";

/** 8 hành động của màn chi tiết. `edit` tách khỏi `update` vì nút Sửa mở form, không mutate ngay. */
export type AssetAction =
  | "assign"
  | "revoke"
  | "openMaintenance"
  | "closeMaintenance"
  | "dispose"
  | "markLost"
  | "recover"
  | "edit"
  | "delete";

/** Lát cắt tối thiểu của `assetDetailResponseSchema` mà việc suy nút cần. */
export interface AssetActionSubject {
  readonly status: AssetLifecycleStatusDto;
  /**
   * `undefined` = không có người giữ HOẶC người giữ ngoài scope danh tính của caller (contracts khai
   * `.optional()` — trường VẮNG KHOÁ, không phải `null`). Hai ca này KHÔNG phân biệt được ở FE.
   */
  readonly currentHolder?: unknown;
  /** Lượt bảo trì đang mở, `null` khi không có. */
  readonly openMaintenance: unknown | null;
  readonly counts: { readonly assignments: number; readonly maintenances: number };
}

/** Quyền hiệu dụng của người đang xem (đã map qua `useCan` ở page). */
export interface AssetActionPermissions {
  readonly canCreate: boolean;
  readonly canUpdate: boolean;
  readonly canDelete: boolean;
  readonly canAssign: boolean;
  readonly canRevoke: boolean;
  readonly canDispose: boolean;
  readonly canManageMaintenance: boolean;
}

/**
 * `true` khi tài sản CHẮC CHẮN còn một lượt cấp phát đang hiệu lực.
 *
 * `status === "Assigned"` là tín hiệu chắc chắn. `currentHolder` có mặt cũng vậy — nhưng VẮNG nó
 * KHÔNG chứng minh điều ngược lại (có thể chỉ là ngoài scope danh tính). Vì thế hàm này chỉ dùng cho
 * vế "chặn", không dùng cho vế "cho phép": fail-closed.
 */
export function hasActiveAssignment(asset: AssetActionSubject): boolean {
  return asset.status === "Assigned" || asset.currentHolder !== undefined;
}

/**
 * FSM cho phép hành động này không — thuần trạng thái, chưa xét quyền (SPEC-13 §13.1).
 * Tách riêng để spec neo được bảng FSM mà không phải dựng 7 cờ quyền cho mỗi ca.
 */
export function isAllowedByFsm(action: AssetAction, asset: AssetActionSubject): boolean {
  const openMaintenance = asset.openMaintenance !== null;
  switch (action) {
    case "assign":
      return asset.status === "In Stock";
    case "revoke":
      // KHÔNG chỉ `Assigned`: bảng FSM của BE (`asset-fsm.ts` ASSET_TRANSITIONS) có cả ô đường chéo
      // `Under Maintenance → Under Maintenance: revoke` — thu hồi khi đang bảo trì thì lượt sang
      // `Returned` còn `status` giữ nguyên. Bỏ ô đó là dựng NGÕ CỤT: tài sản đang bảo trì mà còn người
      // giữ sẽ không thu hồi được từ UI, và vì còn lượt Active nên cũng không thanh lý được (ERR-008).
      //
      // Vế `hasActiveAssignment` chặn ASSET-ERR-003 (thu hồi khi không có lượt Active). Với người có
      // `revoke:asset` — cặp CHỈ cấp ở scope Company (SPEC-13 §11) — `currentHolder` không bao giờ bị
      // che vì lý do scope danh tính, nên tín hiệu này đáng tin ĐÚNG CHO NHÓM thấy được nút này.
      return (
        hasActiveAssignment(asset) &&
        (asset.status === "Assigned" || asset.status === "Under Maintenance")
      );
    case "openMaintenance":
      // Mở được từ CẢ `In Stock` lẫn `Assigned` (người giữ vẫn giữ lượt Active — ASSET-FUNC-006).
      return (asset.status === "In Stock" || asset.status === "Assigned") && !openMaintenance;
    case "closeMaintenance":
      // Đòi CẢ HAI: bảng FSM chỉ có `Under Maintenance → {In Stock, Assigned}: closeMaintenance`. Hôm nay
      // `openMaintenance !== null` kéo theo status = Under Maintenance, nhưng neo cả hai để nếu quan hệ đó
      // đứt (hồ sơ thanh lý tự đóng lượt, chẳng hạn) thì nút biến mất chứ không dẫn tới 409.
      return openMaintenance && asset.status === "Under Maintenance";
    case "dispose":
      // ASSET-ERR-008: chặn theo sự tồn tại lượt Active, KHÔNG theo status. `Assigned` bị loại bởi
      // hasActiveAssignment; `Under Maintenance` còn người giữ cũng bị loại — đó là điểm mấu chốt.
      return (
        (asset.status === "In Stock" || asset.status === "Under Maintenance") &&
        !hasActiveAssignment(asset)
      );
    case "markLost":
      // Ghi nhận mất ĐƯỢC phép khi còn người giữ — service tự đóng lượt với `return_condition='Lost'`.
      return (
        asset.status === "In Stock" ||
        asset.status === "Assigned" ||
        asset.status === "Under Maintenance"
      );
    case "recover":
      return asset.status === "Lost";
    case "edit":
      // Sửa mô tả: chặn ở trạng thái CUỐI — hồ sơ đã thanh lý/mất không còn là dữ liệu sống.
      return asset.status !== "Disposed" && asset.status !== "Lost";
    case "delete":
      // ASSET-ERR-015: chỉ `In Stock` VÀ chưa có bất kỳ lượt cấp phát/bảo trì nào.
      return (
        asset.status === "In Stock" &&
        asset.counts.assignments === 0 &&
        asset.counts.maintenances === 0
      );
  }
}

/** Cặp quyền tương ứng mỗi hành động. */
function isAllowedByPermission(action: AssetAction, can: AssetActionPermissions): boolean {
  switch (action) {
    case "assign":
      return can.canAssign;
    case "revoke":
      return can.canRevoke;
    case "openMaintenance":
    case "closeMaintenance":
      return can.canManageMaintenance;
    case "dispose":
    case "markLost":
    case "recover":
      // MỘT cặp `dispose:asset` gate cả ba (SPEC-13 §11) — không tách.
      return can.canDispose;
    case "edit":
      return can.canUpdate;
    case "delete":
      return can.canDelete;
  }
}

/** Hành động hiện được không = FSM cho phép **VÀ** có quyền. */
export function canDoAssetAction(
  action: AssetAction,
  asset: AssetActionSubject,
  can: AssetActionPermissions,
): boolean {
  return isAllowedByFsm(action, asset) && isAllowedByPermission(action, can);
}

/** Thứ tự hiển thị nút trên thanh hành động — nghiệp vụ thường dùng trước. */
export const ASSET_ACTION_ORDER: readonly AssetAction[] = [
  "assign",
  "revoke",
  "openMaintenance",
  "closeMaintenance",
  "dispose",
  "markLost",
  "recover",
  "edit",
  "delete",
];

/** Danh sách hành động hiện được, đã sắp theo `ASSET_ACTION_ORDER`. */
export function availableAssetActions(
  asset: AssetActionSubject,
  can: AssetActionPermissions,
): readonly AssetAction[] {
  return ASSET_ACTION_ORDER.filter((a) => canDoAssetAction(a, asset, can));
}
