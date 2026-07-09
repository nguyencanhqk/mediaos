import { z } from "zod";
import {
  employeeFileDtoSchema,
  registerFileResponseSchema,
  confirmUploadResponseSchema,
  type EmployeeFileDto,
  type ListEmployeeFilesQuery,
  type RegisterFileResponse,
} from "@mediaos/contracts";
import { apiFetch } from "./api-client";
import { buildQueryString } from "./api-params";

/**
 * Employee File API client — S2-FE-HR-9 (nối S2-HR-EMPFILE-1, API-03 HR-API-801..805 +
 * S2-FND-FILE-2 upload 2-pha). Tab "File hồ sơ" trong EmployeeDetailPage (UI-HR-SCREEN-015).
 *
 * BẤT BIẾN: company_id do SERVER resolve từ auth context — client KHÔNG gửi/forward. Masking là việc
 * của SERVER — client chỉ render field nhận được (EmployeeFileDto KHÔNG có storagePath/checksum/…).
 * Permission: file-view:employee (đọc/list/metadata) · file-upload:employee (link sau khi đã upload+
 * confirm qua Foundation) · file-delete:employee (soft-delete). Foundation 2 pha đầu (register/confirm)
 * gate riêng bởi upload:foundation-file (BE, ngoài phạm vi FE lane này — xem ghi chú uploadEmployeeFile).
 */

const employeeFileListSchema = z.array(employeeFileDtoSchema);

/** module_code/entity_type khớp employee-file.repository.ts (apps/api) — dùng để gắn metadata lúc register. */
const HR_MODULE_CODE = "HR";
const EMPLOYEE_ENTITY_TYPE = "employee_profile";
const DEFAULT_UPLOAD_MIME = "application/octet-stream";

export interface UploadEmployeeFileOptions {
  /** Nhãn phân loại tài liệu (CCCD/Bằng cấp/Hợp đồng/Khác…) — lưu vào file_links.purpose (server). */
  category?: string;
  /** Callback tiến độ upload (0-100) — cập nhật khi PUT bytes lên storage. */
  onProgress?: (percent: number) => void;
  /** Hủy upload giữa chừng (chỉ hủy được pha PUT — pha register/confirm/link không hủy giữa chừng). */
  signal?: AbortSignal;
}

/**
 * PUT bytes trực tiếp lên presigned URL (S3/MinIO) bằng XMLHttpRequest — fetch KHÔNG hỗ trợ theo dõi
 * tiến độ upload nhất quán trên mọi trình duyệt/runtime. Content-Type PHẢI khớp giá trị đã khai báo lúc
 * register (server ký PutObjectCommand kèm ContentType/ContentLength — sai lệch ⇒ 403 SignatureDoesNotMatch).
 * Dùng `globalThis.XMLHttpRequest` (thay vì tham chiếu trực tiếp) để test (Vitest env "node") stub được.
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

export const employeeFilesApi = {
  /** GET /hr/employees/:id/files — danh sách file hồ sơ nhân viên. Permission: file-view:employee. */
  getEmployeeFiles: (
    employeeId: string,
    query?: Partial<ListEmployeeFilesQuery>,
  ): Promise<EmployeeFileDto[]> =>
    apiFetch(
      `/hr/employees/${employeeId}/files${buildQueryString(query ?? {})}`,
      employeeFileListSchema,
    ),

  /**
   * Upload + gắn 1 file vào hồ sơ nhân viên — 4 pha (S2-FND-FILE-2 + S2-HR-EMPFILE-1). Bất kỳ pha nào
   * lỗi → ném lỗi ngay, KHÔNG âm thầm bỏ qua pha sau (silent-failure):
   *   (1) POST /foundation/files/upload — register metadata (Private/Pending) + presigned-PUT.
   *   (2) PUT bytes trực tiếp lên storage (XHR, có tiến độ qua onProgress).
   *   (3) POST /foundation/files/:id/confirm — verify size/tồn tại + checksum server-side.
   *   (4) POST /hr/employees/:id/files — gắn file đã confirm vào hồ sơ (permission file-upload:employee).
   * LƯU Ý: pha (1)+(3) hiện gate bởi `upload:foundation-file` (Foundation), KHÔNG phải `file-upload:
   * employee` — role hr hiện CHƯA có grant này trong seed (chỉ company-admin qua bulk-grant mig 0435),
   * dù ĐÃ có `file-upload:employee`. Đây là gap phía BE/seed (ngoài phạm vi lane FE này) — nút Upload
   * vẫn gate đúng theo `file-upload:employee` như spec UI-HR-SCREEN-015 yêu cầu; role thiếu grant
   * Foundation sẽ thấy lỗi 403 ở bước (1) khi thao tác thật cho tới khi seed được bổ sung.
   */
  uploadEmployeeFile: async (
    employeeId: string,
    file: File,
    options?: UploadEmployeeFileOptions,
  ): Promise<EmployeeFileDto> => {
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
          moduleCode: HR_MODULE_CODE,
          entityType: EMPLOYEE_ENTITY_TYPE,
          entityId: employeeId,
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

    return apiFetch(`/hr/employees/${employeeId}/files`, employeeFileDtoSchema, {
      method: "POST",
      body: JSON.stringify({ fileId: registered.fileId, category: options?.category }),
    });
  },

  /** DELETE /hr/employees/:id/files/:fileId — soft-delete (204). Permission: file-delete:employee. */
  deleteEmployeeFile: (employeeId: string, fileId: string): Promise<void> =>
    apiFetch(`/hr/employees/${employeeId}/files/${fileId}`, z.void(), { method: "DELETE" }),
};
