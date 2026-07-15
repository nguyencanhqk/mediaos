import { z } from "zod";
import type {
  CreateEmployeeProfileRequest,
  UpdateEmployeeProfileRequest,
} from "@mediaos/contracts";
import { employeeListItemSchema } from "@mediaos/contracts";
import { apiFetch } from "@mediaos/web-core";

/**
 * Employees API client cho apps/console (Hệ thống — tenant plane).
 *
 * Mirror cấu trúc từ apps/people/src/lib/employees-api.ts nhưng dùng trong ngữ cảnh console
 * (aud=user, tenant self). Gate quyền: read/create/update/delete:employee.
 *
 * Import hàng loạt (bulk CSV/XLSX) KHÔNG còn ở đây — route legacy /employees/import[/confirm]
 * (media-era, mã do client cấp, không SequenceService, audit yếu) đã bị GỠ ở BE (S5-HR-IMPORT-BE-1).
 * Import mới thuộc S5-HR-IMPORT-FE-1 ở apps/app, gọi POST /hr/employees/import.
 */

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
  }) => apiFetch(`/employees${buildEmployeeQuery(params)}`, z.array(employeeListItemSchema)),

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
};
