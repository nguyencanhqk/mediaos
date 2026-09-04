/**
 * S14-RECRUIT-FILEGRANT-1 — client tệp CV ứng viên qua bề mặt RECRUIT RIÊNG
 * (`/candidates/:id/files*`, RECRUIT-API-033..037), KHÔNG còn qua `/foundation/files*` generic.
 *
 * ┌─ VÌ SAO ĐỔI ─────────────────────────────────────────────────────────────────────────────────┐
 * │ Bản S12-RECRUIT-FE-1 gọi thẳng 5 route `/foundation/files*`, vốn gate `*:foundation-file` —   │
 * │ cặp mà seed chỉ cấp cho company-admin. Đó là "NỢ SEED" ghi ở docblock cũ. Cách đóng KHÔNG      │
 * │ phải là cấp cặp đó cho recruiter/hr: `view:foundation-file` mở luôn màn quản trị              │
 * │ System > Files, và `GET /foundation/files` không gác per-file ⇒ trình duyệt tệp TOÀN TENANT.  │
 * │ Thay vào đó BE dựng wrapper module-owned với một cặp GHI mới `upload:candidate-file`          │
 * │ (is_sensitive=TRUE, mig 0569) và đường ĐỌC dùng lại `view:candidate`.                          │
 * └───────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * `moduleCode`/`entityType`/`entityId`/`visibility` KHÔNG còn nằm trong payload: cả bốn do SERVER đặt
 * (schema `.strict()` ⇒ gửi lên là 400). Client chỉ khai tên/MIME/kích thước.
 *
 * Danh sách trả **mảng TRẦN** — `apiFetch` + array schema, KHÔNG `apiFetchPaginated`
 * (`apifetch-drops-pagination-bare-array`).
 */
import { z } from "zod";
import {
  recruitCandidateFileSchema,
  recruitCandidateFileUploadUrlInputSchema,
  registerFileResponseSchema,
  confirmUploadResponseSchema,
  downloadUrlSchema,
  type RecruitCandidateFileDto,
  type RegisterFileResponse,
  type DownloadUrlDto,
} from "@mediaos/contracts";
import { apiFetch } from "@mediaos/web-core";

const fileListSchema = z.array(recruitCandidateFileSchema);
const DEFAULT_UPLOAD_MIME = "application/octet-stream";

/** PUT bytes trực tiếp lên presigned URL — mirror `putFileToUrl` của `employee-file-api.ts`. */
function putFileToUrl(url: string, file: File, contentType: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const XHR = (globalThis as { XMLHttpRequest?: typeof XMLHttpRequest }).XMLHttpRequest;
    if (!XHR) {
      reject(new Error("Môi trường hiện tại không hỗ trợ tải file lên (thiếu XMLHttpRequest)."));
      return;
    }
    const xhr = new XHR();
    xhr.open("PUT", url, true);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Tải file lên storage thất bại (HTTP ${xhr.status}).`));
    };
    xhr.onerror = () => reject(new Error("Tải file lên storage thất bại do lỗi mạng."));
    xhr.send(file);
  });
}

export const candidateFileApi = {
  /** 033 — GET /candidates/:id/files. Chỉ tệp đã gắn vào ĐÚNG ứng viên này. */
  listCandidateFiles: (candidateId: string): Promise<RecruitCandidateFileDto[]> =>
    apiFetch(`/candidates/${candidateId}/files`, fileListSchema),

  /** 034 — GET /candidates/:id/files/:fileId/download-url (TTL ngắn; sai ứng viên ⇒ 404). */
  getDownloadUrl: (candidateId: string, fileId: string): Promise<DownloadUrlDto> =>
    apiFetch(`/candidates/${candidateId}/files/${fileId}/download-url`, downloadUrlSchema),

  /**
   * Tải CV lên — 4 pha: 035 upload-url → PUT bytes → 036 confirm → 037 link.
   *
   * Cả chuỗi phải chạy LẠI từ đầu khi retry: BE chặn tái-link một tệp đã từng được gắn (vế 5 của
   * `canLinkFile`, chống bypass thu hồi) ⇒ gọi lại RIÊNG bước link cho cùng tệp sẽ ăn 403, không 409.
   */
  uploadCandidateFile: async (
    candidateId: string,
    file: File,
  ): Promise<RecruitCandidateFileDto> => {
    const declaredMimeType = file.type || DEFAULT_UPLOAD_MIME;
    const body = recruitCandidateFileUploadUrlInputSchema.parse({
      originalName: file.name,
      declaredMimeType,
      sizeBytes: file.size,
    });

    const registered = await apiFetch<RegisterFileResponse>(
      `/candidates/${candidateId}/files/upload-url`,
      registerFileResponseSchema,
      { method: "POST", body: JSON.stringify(body) },
    );

    await putFileToUrl(registered.uploadUrl, file, declaredMimeType);

    await apiFetch(
      `/candidates/${candidateId}/files/${registered.fileId}/confirm`,
      confirmUploadResponseSchema,
      { method: "POST", body: JSON.stringify({}) },
    );

    return apiFetch(
      `/candidates/${candidateId}/files/${registered.fileId}/link`,
      recruitCandidateFileSchema,
      { method: "POST", body: JSON.stringify({}) },
    );
  },
};
