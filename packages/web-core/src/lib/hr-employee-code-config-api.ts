import {
  employeeCodeConfigSchema,
  employeeCodePreviewResponseSchema,
  type EmployeeCodeConfigDto,
  type EmployeeCodePreviewResponse,
  type UpdateEmployeeCodeConfigRequest,
} from "@mediaos/contracts";
import { apiFetch } from "./api-client";

/**
 * HR Employee-code CONFIG admin API client — S2-FE-HR-8 (nối S2-HR-BE-7, API-03 §10.10).
 *
 * Endpoint THẬT (apps/api/src/employees/employee-code-config.controller.ts — spec thắng bản nháp
 * done_when `/hr/settings/employee-code` cũ, đó là ĐƯỜNG DẪN ROUTE FE, KHÔNG phải API path):
 *   GET   /hr/employee-code-config    gate view:employee-code-config    (HR-API-901)
 *   PATCH /hr/employee-code-config    gate update:employee-code-config  (HR-API-902)
 *   POST  /hr/employee-code/preview   gate preview:employee-code        (HR-API-903)
 *
 * `employee_code_configs` chỉ giữ FORMAT mã (prefix/pattern/numberLength/allowManualOverride/status) —
 * bộ đếm chạy (padding/reset_policy/current_value) sống ở `sequence_counters` (S1-FND-SEQ-1) và
 * KHÔNG BAO GIỜ lộ/mutate qua surface này (BẤT BIẾN #3 phía server). Preview CHỈ đọc — KHÔNG có
 * request body (server không nhận tham số nào ảnh hưởng kết quả, không mutate counter).
 */
export const employeeCodeConfigApi = {
  /** GET /hr/employee-code-config — cấu hình hiện tại (hoặc default nếu tenant chưa tạo, KHÔNG 404). */
  getConfig: (): Promise<EmployeeCodeConfigDto> =>
    apiFetch("/hr/employee-code-config", employeeCodeConfigSchema),

  /** PATCH /hr/employee-code-config — sửa 1 phần cấu hình (partial); server audit CONFIG_UPDATE. */
  updateConfig: (body: UpdateEmployeeCodeConfigRequest): Promise<EmployeeCodeConfigDto> =>
    apiFetch("/hr/employee-code-config", employeeCodeConfigSchema, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  /** POST /hr/employee-code/preview — mã NV kế tiếp, KHÔNG mutate counter. */
  previewNextCode: (): Promise<EmployeeCodePreviewResponse> =>
    apiFetch("/hr/employee-code/preview", employeeCodePreviewResponseSchema, {
      method: "POST",
      body: JSON.stringify({}),
    }),
};

export type { EmployeeCodeConfigDto, EmployeeCodePreviewResponse, UpdateEmployeeCodeConfigRequest };
export {
  EMPLOYEE_CODE_NUMBER_LENGTH_MIN,
  EMPLOYEE_CODE_NUMBER_LENGTH_MAX,
} from "@mediaos/contracts";
