import { downloadUrlSchema, type DownloadUrlDto } from "@mediaos/contracts";
import { apiFetch } from "./api-client";

/**
 * File download client (S2-FE-HR-7) — nối FOUNDATION file subsystem đã ship (S1-FND-FILE-1).
 *
 * `getDownloadUrl` gọi GET /foundation/files/:id/download-url (Permission: download:foundation-file) —
 * trả URL TTL-ngắn (KHÔNG bao giờ lộ storage_path). Caller mở URL này (window.open) thay vì điều hướng
 * trực tiếp tới /foundation/files/:id/download (redirect 302 không mang theo Authorization header của
 * fetch-based auth — bắt buộc round-trip qua apiFetch trước để lấy URL đã ký).
 */
export const filesApi = {
  getDownloadUrl: (fileId: string): Promise<DownloadUrlDto> =>
    apiFetch(`/foundation/files/${fileId}/download-url`, downloadUrlSchema),
};
