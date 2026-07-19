import { z } from "zod";
import {
  projectStateSchema,
  type CreateProjectStateRequest,
  type ProjectStateDto,
  type UpdateProjectStateRequest,
} from "@mediaos/contracts";
import { apiFetch } from "./api-client";

/**
 * S5-TASK-PIPELINE-1 (lane fe) — client cột pipeline theo dự án (PM-1 routes ĐÃ sống ở BE:
 * project-states.controller, gate read/create/update/delete:project_state — seed 0420).
 *
 * BẤT BIẾN: company_id do SERVER resolve — client KHÔNG forward. Response validate Zod ở ranh giới.
 * Quản lý cột là thao tác cấu hình board (DECISIONS-03: kỷ luật quy trình nằm ở thứ tự cột) —
 * FE gate hiển thị bằng useCan trên đúng pair, server vẫn là người quyết.
 */
export const taskStatesApi = {
  /** GET /projects/:id/states — danh sách cột (order theo sort_order). Gate read:project_state. */
  listStates: (projectId: string): Promise<ProjectStateDto[]> =>
    apiFetch(`/projects/${projectId}/states`, z.array(projectStateSchema)),

  /** POST /projects/:id/states — thêm cột. Gate create:project_state. */
  createState: (projectId: string, body: CreateProjectStateRequest): Promise<ProjectStateDto> =>
    apiFetch(`/projects/${projectId}/states`, projectStateSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /** PATCH /states/:stateId — đổi tên/màu/thứ tự/cờ default. Gate update:project_state. */
  updateState: (stateId: string, body: UpdateProjectStateRequest): Promise<ProjectStateDto> =>
    apiFetch(`/states/${stateId}`, projectStateSchema, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  /** DELETE /states/:stateId — xoá mềm; còn task sống tham chiếu ⇒ 400 (server chặn). */
  deleteState: (stateId: string): Promise<void> =>
    apiFetch(`/states/${stateId}`, z.void(), { method: "DELETE" }),
};
