import { z } from "zod";
import { meAvatarUploadUrlResponseSchema, setMeAvatarInputSchema } from "@mediaos/contracts";
import { apiFetch } from "./api-client";

const DEFAULT_UPLOAD_MIME = "application/octet-stream";

/**
 * S5-HR-AVATAR-1 — PUT bytes trực tiếp lên presigned URL của storage (S3/MinIO), KHÔNG qua apiFetch (đích
 * là storage, KHÔNG phải API của ta — không gắn Bearer/cookie). MIRROR `putBytesToStorage` của
 * `me-api.ts` (own-scope) — duplicate CÓ CHỦ ĐÍCH (không import chéo file khác `paths` của WO): Content-Type
 * PHẢI khớp `declaredMimeType` đã khai báo lúc upload-url (server ký PutObject kèm ContentType — lệch ⇒
 * 403 SignatureDoesNotMatch). Lỗi mạng/HTTP → ném ngay (KHÔNG nuốt — silent-failure; caller dừng flow,
 * KHÔNG gọi bước set-avatar với file rỗng).
 */
async function putBytesToStorage(url: string, file: File, contentType: string): Promise<void> {
  let res: Response;
  try {
    // credentials:'omit' TƯỜNG MINH — KHÔNG gửi cookie/Bearer tới host storage (đích là S3/MinIO, không
    // phải API của ta).
    res = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body: file,
      credentials: "omit",
    });
  } catch {
    throw new Error("Tải ảnh lên storage thất bại do lỗi mạng.");
  }
  if (!res.ok) throw new Error(`Tải ảnh lên storage thất bại (HTTP ${res.status}).`);
}

/** Response của POST /hr/employees/:id/avatar — CHỈ `{fileId}` (KHÔNG downloadUrl, khác /me/avatar). */
export interface UploadEmployeeAvatarResult {
  fileId: string;
}

/**
 * S5-HR-AVATAR-1 — Employee-avatar API client (HR/admin đặt/gỡ avatar cho NHÂN VIÊN KHÁC, gate
 * `update:employee` — reuse cặp sửa hồ sơ, KHÔNG cặp quyền mới). MIRROR `meApi` avatar own-scope
 * (`me-api.ts`) nhưng theo đường `/hr/employees/:id/avatar*` — `:id` là NV mục tiêu, KHÔNG phải caller
 * (server tự authorize qua `assertWriteScope('update')` + tenant RLS, chống IDOR — SPEC-03 §14.4).
 *
 * Ảnh HIỂN THỊ hiện tại đọc từ `GET /hr/employees/:id` (`hrApi.getEmployee` → `data.avatarUrl`, server
 * đã resolve signed URL) — API này KHÔNG có endpoint GET riêng; set/remove trả `{fileId}` (KHÔNG URL) nên
 * caller PHẢI refetch employee detail để hiển thị ảnh mới (KHÔNG tự suy URL từ fileId ở client).
 *
 * MASKING là việc của SERVER: response validate Zod ở ranh giới — lỗi shape ném ngay, KHÔNG âm thầm coi
 * như thành công.
 */
export const employeeAvatarApi = {
  /**
   * Upload + gắn avatar cho nhân viên `employeeId` — 3 pha (fold confirm vào bước cuối, BE endpoint mới
   * nên không có shipped-regression). Bất kỳ pha nào lỗi → ném NGAY, KHÔNG âm thầm bỏ pha sau:
   *   (1) POST /hr/employees/:id/avatar/upload-url — đăng ký file ảnh + presigned-PUT.
   *   (2) PUT bytes trực tiếp lên storage (Content-Type khớp declaredMimeType).
   *   (3) POST /hr/employees/:id/avatar — confirm + link + set avatar (server), trả `{fileId}`.
   *
   * WHITELIST tường minh: chỉ gửi `{originalName, declaredMimeType, sizeBytes}` rồi `{fileId}` — KHÔNG
   * bao giờ gửi employee/owner field khác (owner resolve từ `:id` đã authorize ở server).
   */
  uploadEmployeeAvatar: async (
    employeeId: string,
    file: File,
  ): Promise<UploadEmployeeAvatarResult> => {
    const declaredMimeType = file.type || DEFAULT_UPLOAD_MIME;
    const reg = await apiFetch(
      `/hr/employees/${employeeId}/avatar/upload-url`,
      meAvatarUploadUrlResponseSchema,
      {
        method: "POST",
        body: JSON.stringify({ originalName: file.name, declaredMimeType, sizeBytes: file.size }),
      },
    );
    await putBytesToStorage(reg.uploadUrl, file, declaredMimeType);
    return apiFetch(`/hr/employees/${employeeId}/avatar`, setMeAvatarInputSchema, {
      method: "POST",
      body: JSON.stringify({ fileId: reg.fileId }),
    });
  },

  /** DELETE /hr/employees/:id/avatar — gỡ avatar hiện có (204). */
  removeEmployeeAvatar: (employeeId: string): Promise<void> =>
    apiFetch(`/hr/employees/${employeeId}/avatar`, z.void(), { method: "DELETE" }),
};
