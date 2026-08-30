import { ConflictException } from "@nestjs/common";
import type { AssetLifecycleStatusDto } from "@mediaos/contracts";
import { ASSET_ERR, ASSET_ERR_CODE } from "./assets.errors";

/**
 * S11-ASSET-BE-1 — FSM trạng thái tài sản (SPEC-13 §13.1) — HỢP ĐỒNG, thuần hàm, 0 DB.
 *
 * MỘT hàm `assertTransition(from, to, action)` cho MỌI mutation trạng thái (API-14 §6.1 — "không controller
 * nào tự kiểm"). Bảng dưới chép NGUYÊN VĂN ma trận SPEC-13 §13.1, kể cả ô đường chéo
 * `(Under Maintenance, Under Maintenance, 'revoke')` — thu hồi khi đang bảo trì: lượt → Returned, status giữ.
 *
 * ⚠️ `assertTransition` CHỈ nhìn `status` — CHƯA ĐỦ (SPEC-13 §13.1 gạch đầu dòng 3): `Under Maintenance` có thể
 * mang lượt cấp phát Active. Kết thúc vòng đời (`Disposed`) PHẢI đi thêm guard thứ hai
 * `assertNoActiveAssignment` ở service (ASSET-ERR-008), trong CÙNG tx, sau `SELECT … FOR UPDATE` hàng assets.
 * Ô `(Assigned → Disposed)` CỐ Ý KHÔNG có trong bảng: SPEC §13.1 đánh dấu ô đó là ✗ **ASSET-ERR-008**
 * (không phải 001) — service chạy guard 008 TRƯỚC `assertTransition` cho `dispose(kind='Disposed')`.
 */
export type AssetStatus = AssetLifecycleStatusDto;

export type AssetAction =
  | "assign"
  | "revoke"
  | "openMaintenance"
  | "closeMaintenance"
  | "dispose"
  | "recover";

type TransitionKey = `${AssetStatus}→${AssetStatus}:${AssetAction}`;

const key = (from: AssetStatus, to: AssetStatus, action: AssetAction): TransitionKey =>
  `${from}→${to}:${action}`;

/** Ma trận SPEC-13 §13.1 — mọi cặp KHÔNG có ở đây là ✗ ASSET-ERR-001. */
export const ASSET_TRANSITIONS: ReadonlySet<TransitionKey> = new Set<TransitionKey>([
  // In Stock
  key("In Stock", "Assigned", "assign"),
  key("In Stock", "Under Maintenance", "openMaintenance"),
  key("In Stock", "Disposed", "dispose"),
  key("In Stock", "Lost", "dispose"),
  // Assigned
  key("Assigned", "In Stock", "revoke"),
  key("Assigned", "Under Maintenance", "openMaintenance"),
  key("Assigned", "Lost", "revoke"),
  key("Assigned", "Lost", "dispose"),
  // Under Maintenance
  key("Under Maintenance", "In Stock", "closeMaintenance"),
  key("Under Maintenance", "Assigned", "closeMaintenance"),
  key("Under Maintenance", "Under Maintenance", "revoke"),
  key("Under Maintenance", "Disposed", "dispose"),
  key("Under Maintenance", "Lost", "revoke"),
  key("Under Maintenance", "Lost", "dispose"),
  // Lost
  key("Lost", "In Stock", "recover"),
]);

export function canTransition(from: AssetStatus, to: AssetStatus, action: AssetAction): boolean {
  return ASSET_TRANSITIONS.has(key(from, to, action));
}

/**
 * Ném **409 ASSET-ERR-001** khi cặp `(from, to, action)` không có trong ma trận. Thông điệp nêu trạng thái hiện
 * tại + hành động bị chặn (SPEC-13 §12); `details` mang `from`/`to`/`action` cho FE/test neo theo dữ liệu.
 */
export function assertTransition(from: AssetStatus, to: AssetStatus, action: AssetAction): void {
  if (canTransition(from, to, action)) return;
  throw new ConflictException({
    code: ASSET_ERR_CODE.TRANSITION,
    message: ASSET_ERR.TRANSITION(from, action),
    details: [
      { field: "from", message: from, rule: "asset-fsm" },
      { field: "to", message: to, rule: "asset-fsm" },
      { field: "action", message: action, rule: "asset-fsm" },
    ],
  });
}

/** Tên hành động tiếng Việt cho thông điệp lỗi (một chỗ, để int-spec không phụ thuộc câu chữ). */
export const ASSET_ACTION_LABEL: Readonly<Record<AssetAction, string>> = {
  assign: "cấp phát",
  revoke: "thu hồi",
  openMaintenance: "mở lượt bảo trì",
  closeMaintenance: "đóng lượt bảo trì",
  dispose: "thanh lý/ghi nhận mất",
  recover: "tìm thấy lại",
};
