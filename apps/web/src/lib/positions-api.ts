import { z } from "zod";
import type { CreatePositionRequest, UpdatePositionRequest } from "@mediaos/contracts";
import { positionSchema } from "@mediaos/contracts";

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

export const positionsApi = {
  listPositions: () => apiFetch("/org/positions", z.array(positionSchema)),
  createPosition: (data: CreatePositionRequest) =>
    apiFetch("/org/positions", positionSchema, { method: "POST", body: JSON.stringify(data) }),
  updatePosition: (id: string, data: UpdatePositionRequest) =>
    apiFetch(`/org/positions/${id}`, positionSchema, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  deletePosition: async (id: string) => {
    const res = await fetch(`${API_URL}/org/positions/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error(`${res.status} DELETE /org/positions/${id}`);
  },
};
