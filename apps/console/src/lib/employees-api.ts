import { z } from "zod";
import type {
  CreateEmployeeProfileRequest,
  UpdateEmployeeProfileRequest,
} from "@mediaos/contracts";
import {
  employeeListItemSchema,
  importEmployeePreviewSchema,
} from "@mediaos/contracts";
import { apiFetch, getAccessToken, getApiBaseUrl, unwrapEnvelope } from "@mediaos/web-core";

/**
 * Employees API client cho apps/console (Hệ thống — tenant plane).
 *
 * Mirror cấu trúc từ apps/people/src/lib/employees-api.ts nhưng dùng trong ngữ cảnh console
 * (aud=user, tenant self). Gate quyền: read/create/update/delete/import:employee.
 */

const confirmResultSchema = z.object({ inserted: z.number(), failed: z.number() });

function buildEmployeeQuery(params?: {
  orgUnitId?: string;
  positionId?: string;
  status?: string;
  search?: string;
}): string {
  const qs = new URLSearchParams();
  if (params?.orgUnitId) qs.set("orgUnitId", params.orgUnitId);
  if (params?.positionId) qs.set("positionId", params.positionId);
  if (params?.status) qs.set("status", params.status);
  if (params?.search) qs.set("search", params.search);
  const s = qs.toString();
  return s ? `?${s}` : "";
}

export const consoleEmployeesApi = {
  /** Danh sách nhân viên (read:employee — server ép RLS + withTenant(JWT.companyId)). */
  listEmployees: (params?: {
    orgUnitId?: string;
    positionId?: string;
    status?: string;
    search?: string;
  }) =>
    apiFetch(
      `/employees${buildEmployeeQuery(params)}`,
      z.array(employeeListItemSchema),
    ),

  /** Tạo nhân viên mới (create:employee). */
  createEmployee: (data: CreateEmployeeProfileRequest) =>
    apiFetch("/employees", employeeListItemSchema, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  /** Cập nhật thông tin nhân viên (update:employee). */
  updateEmployee: (id: string, data: UpdateEmployeeProfileRequest) =>
    apiFetch(`/employees/${id}`, employeeListItemSchema, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  /** Vô hiệu hoá (soft-delete) nhân viên — xoá mềm DELETE trả 204 No Content. */
  deleteEmployee: (id: string) => apiFetch(`/employees/${id}`, z.unknown(), { method: "DELETE" }),

  /**
   * Upload file CSV import nhân viên → trả preview (valid + invalid rows + sessionId).
   * Dùng raw fetch (không apiFetch) vì multipart/form-data không hợp application/json.
   * Bearer token gắn thủ công; KHÔNG có refresh-on-401 — chấp nhận (import là thao tác hiếm,
   * trang đã gọi GET authed trước → token vẫn còn hạn).
   */
  uploadImport: async (file: File) => {
    const form = new FormData();
    form.append("file", file);
    const token = getAccessToken();
    const res = await fetch(`${getApiBaseUrl()}/employees/import`, {
      method: "POST",
      credentials: "include",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });
    if (!res.ok) throw new Error(await res.text().catch(() => "Upload failed"));
    const json: unknown = await res.json();
    return importEmployeePreviewSchema.parse(unwrapEnvelope(json));
  },

  /** Xác nhận import sau khi xem trước — ghi vào DB (import:employee). */
  confirmImport: (sessionId: string) =>
    apiFetch("/employees/import/confirm", confirmResultSchema, {
      method: "POST",
      body: JSON.stringify({ sessionId }),
    }),
};
