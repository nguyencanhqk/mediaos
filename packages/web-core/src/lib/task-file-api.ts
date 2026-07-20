import { z } from "zod";
import {
  taskFileDtoSchema,
  registerFileResponseSchema,
  confirmUploadResponseSchema,
  type TaskFileDto,
  type ListTaskFilesQuery,
  type RegisterFileResponse,
} from "@mediaos/contracts";
import { apiFetch, apiFetchBlob, type ApiBlobResult } from "./api-client";
import { buildQueryString } from "./api-params";

/**
 * Task File API client — S4-FE-TASK-4 (nối S4-TASK-BE-5, API-06 canonical `/tasks/:taskId/files`, PR #184).
 * TÁI DÙNG NGUYÊN pattern employee-file-api.ts (S2-HR-EMPFILE-1) — upload 4-pha (register/PUT/confirm/link),
 * KHÁC moduleCode/entityType (mirror apps/api task-file.repository.ts TASK_MODULE='TASK' TASK_ENTITY='task').
 *
 * BẤT BIẾN: company_id do SERVER resolve từ auth context — client KHÔNG gửi/forward. Masking là việc của
 * SERVER — client chỉ render field nhận được (TaskFileDto KHÔNG có storagePath/checksum/…).
 * Permission: read:task (list/metadata/download) · file-upload:task (link sau khi đã upload+confirm qua
 * Foundation) · file-delete:task (soft-delete). Foundation 2 pha đầu (register/confirm) gate riêng bởi
 * upload:foundation-file (BE, ngoài phạm vi lane này — mirror ghi chú uploadEmployeeFile).
 *
 * KHÔNG có route JSON `/tasks/:taskId/files/:fileId/download-url` (chỉ redirect 302 `/download` —
 * task-files.controller.ts) — downloadTaskFile dùng apiFetchBlob (mirror files-api.ts pattern export CSV):
 * apiFetchBlob gắn Bearer cho hop ĐẦU (API), fetch tự theo dõi redirect 302 tới storage; trình duyệt hiện đại
 * TỰ bỏ header Authorization khi redirect cross-origin (Fetch spec) nên KHÔNG lộ token cho storage backend.
 *
 * NỢ KỸ THUẬT (ghi nhận tường minh, KHÔNG che giấu): khác `filesApi.getDownloadUrl` (JSON URL rồi
 * `window.open` — full navigation, KHÔNG cần CORS), `apiFetchBlob` đọc BODY của response sau redirect bằng
 * JS (`fetch().blob()`) ⇒ storage backend (S3/R2/MinIO) PHẢI bật CORS (Access-Control-Allow-Origin) cho GET
 * từ origin app — repo hiện KHÔNG thấy cấu hình CORS bucket nào (devops/docker-compose). Nếu bucket CHƯA
 * bật CORS, download sẽ lỗi network ở trình duyệt thật (test unit mock apiFetchBlob nên KHÔNG bắt được gap
 * này). Fix triệt để cần 1 trong 2: (a) BE thêm route JSON `/tasks/:taskId/files/:fileId/download-url`
 * (mirror `/foundation/files/:id/download-url`) để FE window.open thẳng (khỏi cần CORS); hoặc (b)
 * devops/BE bật CORS GET cho bucket storage. Ngoài phạm vi lane FE này — cờ cho BE/DevOps.
 */

const taskFileListSchema = z.array(taskFileDtoSchema);

/** module_code/entity_type khớp task-file.repository.ts (apps/api) — dùng để gắn metadata lúc register. */
const TASK_MODULE_CODE = "TASK";
const TASK_ENTITY_TYPE = "task";
const DEFAULT_UPLOAD_MIME = "application/octet-stream";

export interface UploadTaskFileOptions {
  /** Nhãn phân loại tài liệu (Attachment/Proof/Spec/Khác…) — lưu vào file_links.purpose (server). */
  category?: string;
  /** Callback tiến độ upload (0-100) — cập nhật khi PUT bytes lên storage. */
  onProgress?: (percent: number) => void;
  /** Hủy upload giữa chừng (chỉ hủy được pha PUT — pha register/confirm/link không hủy giữa chừng). */
  signal?: AbortSignal;
}

/**
 * PUT bytes trực tiếp lên presigned URL (S3/MinIO) bằng XMLHttpRequest — mirror employee-file-api.ts (fetch
 * KHÔNG hỗ trợ theo dõi tiến độ upload nhất quán). Bản sao cục bộ theo feature TASK (tránh coupling chéo
 * TASK↔HR qua 1 helper dùng chung — mirror kỹ thuật download-blob.ts đã dùng ở HR/attendance).
 */
function putFileToUrl(
  url: string,
  file: File,
  contentType: string,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const XHR = (globalThis as { XMLHttpRequest?: typeof XMLHttpRequest }).XMLHttpRequest;
    if (!XHR) {
      reject(new Error("Môi trường hiện tại không hỗ trợ tải file lên (thiếu XMLHttpRequest)."));
      return;
    }
    const xhr = new XHR();
    xhr.open("PUT", url, true);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (evt) => {
      if (onProgress && evt.lengthComputable) {
        onProgress(Math.round((evt.loaded / evt.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(100);
        resolve();
      } else {
        reject(new Error(`Tải file lên storage thất bại (HTTP ${xhr.status}).`));
      }
    };
    xhr.onerror = () => reject(new Error("Tải file lên storage thất bại do lỗi mạng."));
    xhr.onabort = () => reject(new Error("Tải file lên đã bị hủy."));
    if (signal) {
      if (signal.aborted) {
        xhr.abort();
        return;
      }
      signal.addEventListener("abort", () => xhr.abort(), { once: true });
    }
    xhr.send(file);
  });
}

export const taskFileApi = {
  /** GET /tasks/:taskId/files — danh sách file đính kèm công việc. Permission: read:task. */
  getTaskFiles: (taskId: string, query?: Partial<ListTaskFilesQuery>): Promise<TaskFileDto[]> =>
    apiFetch(`/tasks/${taskId}/files${buildQueryString(query ?? {})}`, taskFileListSchema),

  /**
   * Upload + gắn 1 file vào công việc — 4 pha (mirror employeeFilesApi.uploadEmployeeFile). Bất kỳ pha nào
   * lỗi → ném lỗi ngay, KHÔNG âm thầm bỏ qua pha sau (silent-failure):
   *   (1) POST /foundation/files/upload — register metadata (Private/Pending) + presigned-PUT.
   *   (2) PUT bytes trực tiếp lên storage (XHR, có tiến độ qua onProgress).
   *   (3) POST /foundation/files/:id/confirm — verify size/tồn tại + checksum server-side.
   *   (4) POST /tasks/:taskId/files — gắn file đã confirm vào công việc (permission file-upload:task).
   */
  uploadTaskFile: async (
    taskId: string,
    file: File,
    options?: UploadTaskFileOptions,
  ): Promise<TaskFileDto> => {
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
          moduleCode: TASK_MODULE_CODE,
          entityType: TASK_ENTITY_TYPE,
          entityId: taskId,
        }),
      },
    );

    await putFileToUrl(
      registered.uploadUrl,
      file,
      declaredMimeType,
      options?.onProgress,
      options?.signal,
    );

    await apiFetch(`/foundation/files/${registered.fileId}/confirm`, confirmUploadResponseSchema, {
      method: "POST",
      body: JSON.stringify({}),
    });

    return apiFetch(`/tasks/${taskId}/files`, taskFileDtoSchema, {
      method: "POST",
      body: JSON.stringify({ fileId: registered.fileId, category: options?.category }),
    });
  },

  /** DELETE /tasks/:taskId/files/:fileId — soft-delete (204). Permission: file-delete:task. */
  deleteTaskFile: (taskId: string, fileId: string): Promise<void> =>
    apiFetch(`/tasks/${taskId}/files/${fileId}`, z.void(), { method: "DELETE" }),

  /**
   * POST /tasks/:taskId/files/:fileId/cover — đặt tệp ĐÃ đính kèm làm ảnh bìa. Permission file-upload:task.
   *
   * Server chỉ nhận tệp đã là đính kèm SỐNG của chính task đó + là ảnh + Uploaded + scan sạch + KHÔNG
   * gắn ở nơi nào khác. Lỗi thường gặp mà FE nên phân biệt: 415 (không phải ảnh) · 409 (chưa upload
   * xong / chưa quét sạch / đang gắn ở entity khác) · 404 (tệp không thuộc task).
   */
  setTaskCover: (taskId: string, fileId: string): Promise<TaskFileDto> =>
    apiFetch(`/tasks/${taskId}/files/${fileId}/cover`, taskFileDtoSchema, { method: "POST" }),

  /**
   * DELETE /tasks/:taskId/files/cover — gỡ ảnh bìa (204, idempotent). Permission file-upload:task
   * (CÙNG cặp với đặt bìa — thao tác này không xoá tệp nào).
   *
   * Đường dẫn là `/files/cover`, KHÔNG phải `/tasks/:taskId/cover`: controller prefix là
   * `tasks/:taskId/files` nên mọi route đều mang tiền tố đó.
   */
  clearTaskCover: (taskId: string): Promise<void> =>
    apiFetch(`/tasks/${taskId}/files/cover`, z.void(), { method: "DELETE" }),

  /**
   * Tải file nhị phân — GET /tasks/:taskId/files/:fileId/download (302 redirect, permission read:task).
   * apiFetchBlob theo redirect + trả { blob, filename } (filename suy từ Content-Disposition nếu storage
   * backend gửi kèm — caller fallback về TaskFileDto.originalName khi vắng).
   */
  downloadTaskFile: (taskId: string, fileId: string): Promise<ApiBlobResult> =>
    apiFetchBlob(`/tasks/${taskId}/files/${fileId}/download`),
};
