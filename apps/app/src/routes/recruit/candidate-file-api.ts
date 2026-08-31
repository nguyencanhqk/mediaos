/**
 * S12-RECRUIT-FE-1 — client CV ứng viên qua Foundation Files GENERIC (API-09), KHÔNG qua route RECRUIT
 * riêng (RECRUIT không có route upload/tải — `RecruitCandidateFileResolver` phía BE đăng ký cặp
 * (module='RECRUIT', entity='candidate') vào chính surface chung `foundation/files`).
 *
 * File này SỐNG Ở `apps/app` (KHÔNG phải `packages/web-core`) — tái dùng `apiFetch`/`apiFetchPaginated`
 * đã export sẵn + schema `@mediaos/contracts` đã export sẵn (`listFilesQuerySchema`, `fileMetadataSchema`,
 * `linkFileInputSchema`, `registerFileResponseSchema`, `confirmUploadResponseSchema`). KHÔNG chế endpoint:
 * cả 5 route `/foundation/files*` dùng ở đây đều tồn tại thật (`files.controller.ts`), đã có sẵn client
 * mẫu cùng shape ở `employeeFilesApi.uploadEmployeeFile` (khác ở bước cuối: RECRUIT KHÔNG có route
 * "gắn theo module" riêng như `/hr/employees/:id/files` — bước cuối ở đây gọi THẲNG
 * `POST /foundation/files/:id/links` generic, đúng route đã có sẵn cho MỌI module).
 *
 * ⚠️ NỢ SEED (ghi nhận tường minh, KHÔNG che giấu — cùng lớp gap đã note ở `employee-file-api.ts`):
 * migration 0435 chỉ grant `upload/view/download/link/unlink:foundation-file` cho `company-admin`
 * (role 0001) — role `recruiter`/`hr` CHƯA có các quyền này trong seed hiện tại. Nút Tải CV vẫn gate
 * ĐÚNG theo cặp thật (`useCan(..., 'foundation-file')`) — role thiếu grant sẽ thấy nút ẩn (PermissionGate)
 * hoặc 403 nếu gọi thẳng API; đây là gap BE/seed cần WO riêng, KHÔNG phải lỗi ở client này.
 */
import { z } from "zod";
import {
  fileMetadataSchema,
  fileLinkSchema,
  listFilesQuerySchema,
  linkFileInputSchema,
  registerFileResponseSchema,
  confirmUploadResponseSchema,
  downloadUrlSchema,
  type FileMetadataDto,
  type RegisterFileResponse,
  type DownloadUrlDto,
} from "@mediaos/contracts";
import { apiFetch } from "@mediaos/web-core";
import { RECRUIT_FILE_MODULE_CODE, RECRUIT_FILE_ENTITY_TYPE } from "./constants";

const fileListSchema = z.array(fileMetadataSchema);
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
  /** GET /foundation/files?moduleCode=RECRUIT&entityType=candidate&entityId=:id — CV + tài liệu đã gắn. */
  listCandidateFiles: (candidateId: string): Promise<FileMetadataDto[]> => {
    const query = listFilesQuerySchema.parse({
      moduleCode: RECRUIT_FILE_MODULE_CODE,
      entityType: RECRUIT_FILE_ENTITY_TYPE,
      entityId: candidateId,
      limit: 50,
    });
    const params = new URLSearchParams({
      moduleCode: query.moduleCode ?? "",
      entityType: query.entityType ?? "",
      entityId: query.entityId ?? "",
      limit: String(query.limit),
      page: String(query.page),
    });
    return apiFetch(`/foundation/files?${params.toString()}`, fileListSchema);
  },

  /** URL tải TTL-ngắn — mirror `filesApi.getDownloadUrl`. */
  getDownloadUrl: (fileId: string): Promise<DownloadUrlDto> =>
    apiFetch(`/foundation/files/${fileId}/download-url`, downloadUrlSchema),

  /**
   * Upload + gắn CV vào ứng viên — 3 pha (register → PUT bytes → confirm), rồi POST /:id/links generic
   * (linkType='Document', accessScope='Company' — Candidate CHỈ Company theo §13.6).
   */
  uploadCandidateFile: async (candidateId: string, file: File): Promise<FileMetadataDto> => {
    const declaredMimeType = file.type || DEFAULT_UPLOAD_MIME;

    const registered = await apiFetch<RegisterFileResponse>(
      "/foundation/files/upload",
      registerFileResponseSchema,
      {
        method: "POST",
        body: JSON.stringify({
          originalName: file.name,
          declaredMimeType,
          sizeBytes: file.size,
          visibility: "Private",
          moduleCode: RECRUIT_FILE_MODULE_CODE,
          entityType: RECRUIT_FILE_ENTITY_TYPE,
          entityId: candidateId,
        }),
      },
    );

    await putFileToUrl(registered.uploadUrl, file, declaredMimeType);

    await apiFetch(`/foundation/files/${registered.fileId}/confirm`, confirmUploadResponseSchema, {
      method: "POST",
      body: JSON.stringify({}),
    });

    const linkBody = linkFileInputSchema.parse({
      fileId: registered.fileId,
      moduleCode: RECRUIT_FILE_MODULE_CODE,
      entityType: RECRUIT_FILE_ENTITY_TYPE,
      entityId: candidateId,
      linkType: "Document",
      accessScope: "Company",
      isPrimary: false,
      purpose: "CV",
    });
    await apiFetch(`/foundation/files/${registered.fileId}/links`, fileLinkSchema, {
      method: "POST",
      body: JSON.stringify(linkBody),
    });

    return apiFetch(`/foundation/files/${registered.fileId}`, fileMetadataSchema);
  },
};
