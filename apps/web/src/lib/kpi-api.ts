import { z } from "zod";
import type {
  ComputeKpiRequest,
  ConfirmKpiResultRequest,
  ListKpiResultQuery,
} from "@mediaos/contracts";
import {
  kpiDefinitionSchema,
  kpiResultSchema,
  listKpiResultResponseSchema,
} from "@mediaos/contracts";
import { apiFetch } from "./api-client";

/**
 * Client KPI/Mục tiêu (G8-4). TÁI DÙNG schema Zod nguồn-sự-thật ở @mediaos/contracts +
 * apiFetch chung (gắn Bearer + gỡ envelope). KHÔNG tự chế DTO/permission.
 *
 * Endpoint BE (kpi.controller.ts):
 *  - GET  /kpi/definitions  → danh sách định nghĩa KPI (chỉ cần đăng nhập).
 *  - GET  /kpi/results      → lịch sử kết quả KPI (read:kpi; server lọc scope của-mình cho employee).
 *  - POST /kpi/compute      → tính 1 snapshot KPI (permission read:kpi — server fail-closed).
 *  - POST /kpi/confirm      → xác nhận KPI (BR-007, permission confirm:kpi).
 *
 * Mask mặc định: UI render ĐÚNG những gì server trả (BẤT BIẾN #2 — kpi_results append-only). Quyền
 * xem rộng/hẹp do SERVER quyết; client KHÔNG tự lọc chủ thể.
 */

/** Dựng query string cho GET /kpi/results — chỉ gắn tham số có giá trị (confirmedOnly chỉ khi true). */
function buildResultQuery(query?: Partial<ListKpiResultQuery>): string {
  if (!query) return "";
  const params = new URLSearchParams();
  if (query.definitionId) params.set("definitionId", query.definitionId);
  if (query.subjectUserId) params.set("subjectUserId", query.subjectUserId);
  if (query.subjectTeamId) params.set("subjectTeamId", query.subjectTeamId);
  if (query.periodFrom) params.set("periodFrom", query.periodFrom);
  if (query.periodTo) params.set("periodTo", query.periodTo);
  if (query.confirmedOnly) params.set("confirmedOnly", "true");
  if (query.limit != null) params.set("limit", String(query.limit));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export const kpiApi = {
  /** GET /kpi/definitions — định nghĩa KPI active của tenant (kèm inactive nếu yêu cầu). */
  listDefinitions: (params?: { includeInactive?: boolean }) => {
    const qs = params?.includeInactive ? "?includeInactive=true" : "";
    return apiFetch(`/kpi/definitions${qs}`, z.array(kpiDefinitionSchema));
  },

  /** GET /kpi/results — lịch sử kết quả KPI (mới nhất trước). Server đã lọc scope theo quyền caller. */
  listResults: (query?: Partial<ListKpiResultQuery>) =>
    apiFetch(`/kpi/results${buildResultQuery(query)}`, listKpiResultResponseSchema),

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
