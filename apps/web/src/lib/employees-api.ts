import { z } from "zod";
import type { CreateEmployeeProfileRequest } from "@mediaos/contracts";
import {
  employeeListItemSchema,
  employeeProfileSchema,
  importEmployeePreviewSchema,
} from "@mediaos/contracts";
import { apiFetch, getAccessToken, getApiBaseUrl, unwrapEnvelope } from "@mediaos/web-core";

const confirmResultSchema = z.object({ inserted: z.number(), failed: z.number() });

export const employeesApi = {
  listEmployees: (params?: { orgUnitId?: string; positionId?: string; status?: string }) => {
    const qs = new URLSearchParams();
    if (params?.orgUnitId) qs.set("orgUnitId", params.orgUnitId);
    if (params?.positionId) qs.set("positionId", params.positionId);
    if (params?.status) qs.set("status", params.status);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return apiFetch(`/employees${suffix}`, z.array(employeeListItemSchema));
  },

  getOne: (id: string) => apiFetch(`/employees/${id}`, employeeProfileSchema),

  createEmployee: (data: CreateEmployeeProfileRequest) =>
    apiFetch("/employees", employeeListItemSchema, { method: "POST", body: JSON.stringify(data) }),

  // DELETE trả 204 No Content → web-core apiFetch trả undefined; schema z.unknown() chấp nhận.
  deleteEmployee: (id: string) => apiFetch(`/employees/${id}`, z.unknown(), { method: "DELETE" }),

  uploadImport: async (file: File) => {
    // Multipart upload: web-core `apiFetch` hardcode Content-Type=application/json (không hợp FormData),
    // nên gọi `fetch` thẳng — NHƯNG vẫn gắn Bearer (getAccessToken) + credentials:'include' (refresh cookie)
    // như mọi request authed. KHÔNG set Content-Type → browser tự đặt multipart boundary.
    // Lưu ý: nhánh raw này không có refresh-on-401 của apiFetch; import là thao tác hiếm + trang đã gọi
    // các GET authed trước đó (đã silent-refresh) nên access token thường còn hạn — chấp nhận đánh đổi này.
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

  confirmImport: (sessionId: string) =>
    apiFetch("/employees/import/confirm", confirmResultSchema, {
      method: "POST",
      body: JSON.stringify({ sessionId }),
    }),
};
