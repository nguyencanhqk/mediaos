/**
 * S2-FE-HR-4 — Hằng dùng chung cho 3 màn Profile change request:
 *   /hr/me/change-request (HR-SCREEN-016/017) · /hr/profile-change-requests (HR-SCREEN-018) ·
 *   /hr/profile-change-requests/:id (HR-SCREEN-019).
 *
 * CỔNG QUYỀN: cặp ENGINE THỰC seed mig 0444 (ProfileChangeRequestController):
 *   create:profile-change-request  (Own, cả 4 role) — self-service (gửi/xem của tôi/hủy + GET :id).
 *   approve:profile-change-request (Company, hr/company-admin) — HR duyệt/từ chối + GET danh sách.
 * PIN theo cặp seed THẬT (literal), KHÔNG qua PERMISSION_CODE_TO_PAIR của web-core (tránh drift —
 * cùng kỹ thuật system.login-logs / system.files).
 */
import { type RouteMeta } from "@mediaos/web-core";

export const PCR_CREATE_PERMISSION = "create:profile-change-request";
export const PCR_APPROVE_PERMISSION = "approve:profile-change-request";

// 2026-07-21 — /hr/me/change-request GỠ khỏi phần HR (màn + menu): giờ chỉ còn là REDIRECT trong
// router.tsx sang /me/profile/change-requests (ME, S5-ME-FE-2). PCR_ME_ROUTE_META đã xoá theo.
export const PCR_ME_PATH = "/hr/me/change-request";
export const PCR_LIST_PATH = "/hr/profile-change-requests";
export function pcrDetailPath(id: string): string {
  return `/hr/profile-change-requests/${id}`;
}

export const PCR_LIST_ROUTE_META: RouteMeta = {
  routeKey: "hr.profile-change-requests",
  path: PCR_LIST_PATH,
  layout: "MODULE_WORKSPACE",
  moduleCode: "HR",
  screenCode: "HR-SCREEN-018",
  titleKey: "routeTitle.hrProfileChangeRequests",
  requiredAnyPermissions: [PCR_APPROVE_PERMISSION],
  showInSidebar: true,
  order: 24,
};

/** Detail route — reachable từ /hr/me/change-request (self, GET :id thành công). Không sidebar entry. */
export const PCR_DETAIL_ROUTE_META: RouteMeta = {
  routeKey: "hr.profile-change-requests-detail",
  path: "/hr/profile-change-requests/$id",
  layout: "MODULE_WORKSPACE",
  moduleCode: "HR",
  screenCode: "HR-SCREEN-019",
  titleKey: "routeTitle.hrProfileChangeRequestDetail",
  requiredAnyPermissions: [PCR_CREATE_PERMISSION],
};
