import { z } from "zod";
import type { CreatePositionRequest, UpdatePositionRequest } from "@mediaos/contracts";
import { positionSchema } from "@mediaos/contracts";
import { apiFetch } from "@mediaos/web-core";

/**
 * Tùy chọn vai trò cho dropdown "vai trò mặc định" của chức vụ.
 * Nguồn: GET /org/roles (roles catalog — lane BE cung cấp). UI suy biến mềm
 * (dropdown rỗng) nếu endpoint chưa sẵn sàng, vẫn cho tạo/sửa chức vụ.
 */
const roleOptionSchema = z.object({ id: z.string().uuid(), name: z.string() });
export type RoleOption = z.infer<typeof roleOptionSchema>;

export const positionsApi = {
  /** GET /org/positions — lọc theo orgUnitId nếu truyền. */
  listPositions: (orgUnitId?: string) =>
    apiFetch(
      `/org/positions${orgUnitId ? `?orgUnitId=${encodeURIComponent(orgUnitId)}` : ""}`,
      z.array(positionSchema),
    ),
  createPosition: (data: CreatePositionRequest) =>
    apiFetch("/org/positions", positionSchema, { method: "POST", body: JSON.stringify(data) }),
  updatePosition: (id: string, data: UpdatePositionRequest) =>
    apiFetch(`/org/positions/${id}`, positionSchema, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  deletePosition: (id: string) => apiFetch(`/org/positions/${id}`, z.void(), { method: "DELETE" }),
  /** GET /org/roles — danh mục vai trò cho dropdown role mặc định. */
  listRoles: () => apiFetch("/org/roles", z.array(roleOptionSchema)),
};
