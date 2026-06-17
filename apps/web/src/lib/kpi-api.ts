import { z } from "zod";
import type { ComputeKpiRequest, ConfirmKpiResultRequest } from "@mediaos/contracts";
import { kpiDefinitionSchema, kpiResultSchema } from "@mediaos/contracts";
import { apiFetch } from "./api-client";

/**
 * Client KPI/Mục tiêu (G8-4). TÁI DÙNG schema Zod nguồn-sự-thật ở @mediaos/contracts +
 * apiFetch chung (gắn Bearer + gỡ envelope). KHÔNG tự chế DTO/permission.
 *
 * Endpoint BE (kpi.controller.ts):
 *  - GET  /kpi/definitions  → danh sách định nghĩa KPI (chỉ cần đăng nhập).
 *  - POST /kpi/compute      → tính 1 snapshot KPI (permission read:kpi — server fail-closed).
 *  - POST /kpi/confirm      → xác nhận KPI (BR-007, permission confirm:kpi).
 *
 * LƯU Ý DỮ LIỆU: BE CHƯA có GET danh sách kpi_results (lịch sử/tiến độ theo phòng ban). Kết quả
 * KPI chỉ trả về từ POST /kpi/compute. UI render đúng những gì server trả (mask mặc định, BẤT BIẾN #2).
 */
export const kpiApi = {
  /** GET /kpi/definitions — định nghĩa KPI active của tenant (kèm inactive nếu yêu cầu). */
  listDefinitions: (params?: { includeInactive?: boolean }) => {
    const qs = params?.includeInactive ? "?includeInactive=true" : "";
    return apiFetch(`/kpi/definitions${qs}`, z.array(kpiDefinitionSchema));
  },

  /** POST /kpi/compute — tính KPI cho 1 chủ thể (user XOR team) trong 1 kỳ. */
  compute: (body: ComputeKpiRequest) =>
    apiFetch("/kpi/compute", kpiResultSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /** POST /kpi/confirm — xác nhận 1 kết quả KPI (tạo snapshot mới có cờ confirmed). */
  confirm: (body: ConfirmKpiResultRequest) =>
    apiFetch("/kpi/confirm", kpiResultSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),
};
