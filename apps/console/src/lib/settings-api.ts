import { z } from "zod";
import type { UpdateCompanySettingsRequest } from "@mediaos/contracts";
import { companySettingsSchema } from "@mediaos/contracts";

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

export const settingsApi = {
  getCompanySettings: () => apiFetch("/settings/company", companySettingsSchema),
  updateCompanySettings: (data: UpdateCompanySettingsRequest) =>
    apiFetch("/settings/company", companySettingsSchema, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
};
