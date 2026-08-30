import type { Asset, AssetAssignment } from "../db/schema/assets";

/** outbox `event_type` nội bộ — registrar (`notifications/asset-noti-bridge.registrar.ts`) map → `eventCode` catalog. */
export const ASSET_EVENT_ASSIGNED = "asset.assigned";
export const ASSET_EVENT_REVOKED = "asset.revoked";

export interface AssetNotiPayload {
  /** Neo NOTI (`sourceEntityId` + `dedupeKeyOf`) — once-ever theo lượt (SPEC-13 §17). */
  assignmentId: string;
  assetId: string;
  employeeId: string;
  /** Để engine loại actor (is_system_event=false) — KHÔNG phải biến template. */
  actorUserId: string;
  // Biến template 0551: actor_name · asset_name · asset_code — KHÔNG giá mua/chi phí (BẤT BIẾN #3).
  actor_name: string;
  asset_name: string;
  asset_code: string;
  [key: string]: unknown;
}

/**
 * S11-ASSET-BE-1 — payload outbox cho ASSET_ASSIGNED / ASSET_REVOKED (SPEC-13 §17). Chỉ mã + tên tài sản + tên
 * người + id neo; recipient KHÔNG resolve ở đây (registrar đọc `employee_id → user_id` lúc consumer chạy).
 */
export function assetAssignmentPayload(
  assignment: Pick<AssetAssignment, "id" | "assetId" | "employeeId">,
  asset: Pick<Asset, "name" | "assetCode">,
  actorUserId: string,
  actorName: string | null,
): AssetNotiPayload {
  return {
    assignmentId: assignment.id,
    assetId: assignment.assetId,
    employeeId: assignment.employeeId,
    actorUserId,
    // `users.full_name` nullable — KHÔNG quy hành động của người cho "Hệ thống" (gate MEDIUM); nhãn vai trò trung tính.
    actor_name: actorName ?? "Người quản lý tài sản",
    asset_name: asset.name,
    asset_code: asset.assetCode,
  };
}
