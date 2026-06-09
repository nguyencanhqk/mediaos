import { z } from "zod";
import type { CreateEmployeeProfileRequest } from "@mediaos/contracts";
import { employeeListItemSchema, importEmployeePreviewSchema } from "@mediaos/contracts";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3100/api/v1";

async function apiFetch<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} ${path}: ${body}`);
  }
  const json: unknown = await res.json();
  return schema.parse(json);
}

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

  createEmployee: (data: CreateEmployeeProfileRequest) =>
    apiFetch("/employees", employeeListItemSchema, { method: "POST", body: JSON.stringify(data) }),

  deleteEmployee: async (id: string) => {
    const res = await fetch(`${API_URL}/employees/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error(`${res.status} DELETE /employees/${id}`);
  },

  uploadImport: async (file: File) => {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`${API_URL}/employees/import`, { method: "POST", body: form });
    if (!res.ok) throw new Error(await res.text().catch(() => "Upload failed"));
    const json: unknown = await res.json();
    return importEmployeePreviewSchema.parse(json);
  },

  confirmImport: (sessionId: string) =>
    apiFetch("/employees/import/confirm", confirmResultSchema, {
      method: "POST",
      body: JSON.stringify({ sessionId }),
    }),
};
