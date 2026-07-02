/**
 * Hằng dùng cho viewer File metadata (S2-FE-FND-2 · SYSTEM-SCREEN-FILES/`system.files`).
 *
 * CỔNG QUYỀN: cặp ENGINE THỰC ('view','foundation-file') — seed mig 0435 (is_sensitive=false,
 * bulk-grant company-admin qua `WHERE resource_type LIKE 'foundation-%'`) — cặp mà FilesController
 * thật sự @RequirePermission (files.controller.ts). KHÔNG namespace khác.
 *
 * Route `system.files` đăng ký ADDITIVE trong ROUTE_REGISTRY (web-core, S2-FE-FND-2) — router.tsx
 * tạo route mới trỏ tới FilesPage (KHÔNG có ModulePlaceholder cần thay, route hoàn toàn mới).
 */
export const FOUNDATION_FILE_VIEW = {
  action: "view",
  resourceType: "foundation-file",
} as const;

/** Chuỗi quyền route-level literal (cặp engine THẬT) — dùng cho requiredAnyPermissions/sidebar gate. */
export const FOUNDATION_FILE_VIEW_PERMISSION = `${FOUNDATION_FILE_VIEW.action}:${FOUNDATION_FILE_VIEW.resourceType}`;

/** Số dòng mỗi trang (khớp PAGE_LIMIT_DEFAULT ở contract listFilesQuerySchema). */
export const FILES_PAGE_SIZE = 20;

/** Query keys (React Query). */
export const FILES_QUERY_KEY = ["system", "files"] as const;
export const FILE_DETAIL_QUERY_KEY = ["system", "files", "detail"] as const;

/** Đường dẫn route. */
export const FILES_PATH = "/system/files";
export function fileDetailPath(id: string): string {
  return `/system/files/${id}`;
}

/** Endpoint API thật (API-09 FOUNDATION — FilesController). */
export const FILES_API = "/foundation/files";
export function fileDetailApi(id: string): string {
  return `/foundation/files/${id}`;
}
export function fileDownloadApi(id: string): string {
  return `/foundation/files/${id}/download`;
}
