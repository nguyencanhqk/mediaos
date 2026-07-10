import { z } from "zod";
import {
  taskProjectResponseSchema,
  taskProjectListItemSchema,
  memberResponseSchema,
  type TaskProjectResponseDto,
  type TaskProjectListItemDto,
  type MemberResponseDto,
  type CreateTaskProjectRequest,
  type UpdateTaskProjectRequest,
  type CloseTaskProjectRequest,
  type ListTaskProjectsQueryRequest,
  type AddMemberRequest,
  type UpdateMemberRoleRequest,
} from "@mediaos/contracts";
import { apiFetch } from "./api-client";
import { buildQueryString } from "./api-params";

/**
 * TASK Project API client — S4-FE-TASK-1 (SPEC-06 §6.1/§6.5/§6.6, S4-TASK-BE-1 routes ĐÃ merge).
 *
 * BẤT BIẾN: company_id do SERVER resolve từ AuthContext — client KHÔNG nhận/forward (mirror hr-api.ts /
 * tasks-api.ts). Response validate Zod ở ranh giới (schema @mediaos/contracts task.ts). Masking là việc
 * của SERVER — client CHỈ render field nhận được (ownerName/departmentName null khi chưa gán/không tồn tại,
 * KHÔNG phải mask — server luôn trả field này cho mọi role có read:project).
 *
 * List endpoint trả MẢNG TRẦN (TaskProjectListItemDto[] — KHÔNG envelope {items,meta}; xem
 * projects.service.ts listProjects) → validate bằng z.array(schema). Phân trang ở FE làm limit/offset
 * "load more" (KHÔNG có total từ server) — xem ProjectListPage.
 *
 * TUYỆT ĐỐI KHÔNG thêm hàm gọi GET /tasks ở đây — S4-TASK-BE-2 định nghĩa DTO đó song song ở lane khác
 * (xem tasks-api.ts ghi chú tương tự).
 */
export const taskProjectApi = {
  /** GET /projects — danh sách dự án (read:project). Data-scope: employee @Own · manager @Team · hr/admin @Company. */
  listProjects: (
    query?: Partial<ListTaskProjectsQueryRequest>,
  ): Promise<TaskProjectListItemDto[]> =>
    apiFetch(`/projects${buildQueryString(query ?? {})}`, z.array(taskProjectListItemSchema)),

  /** GET /projects/:id — chi tiết dự án (read:project, cùng data-scope với list). */
  getProject: (id: string): Promise<TaskProjectResponseDto> =>
    apiFetch(`/projects/${id}`, taskProjectResponseSchema),

  /** POST /projects — tạo dự án (create:project). Creator=Owner tự động khi actor có employee mapping. */
  createProject: (body: CreateTaskProjectRequest): Promise<TaskProjectResponseDto> =>
    apiFetch("/projects", taskProjectResponseSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /** PATCH /projects/:id — cập nhật (update:project). KHÔNG đổi status (đi qua closeProject). */
  updateProject: (id: string, body: UpdateTaskProjectRequest): Promise<TaskProjectResponseDto> =>
    apiFetch(`/projects/${id}`, taskProjectResponseSchema, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  /** POST /projects/:id/close — đóng dự án (close:project, sensitive). */
  closeProject: (id: string, body?: CloseTaskProjectRequest): Promise<TaskProjectResponseDto> =>
    apiFetch(`/projects/${id}/close`, taskProjectResponseSchema, {
      method: "POST",
      body: JSON.stringify(body ?? {}),
    }),

  /** DELETE /projects/:id — soft-delete (delete:project, sensitive, 204). */
  deleteProject: (id: string): Promise<void> =>
    apiFetch(`/projects/${id}`, z.void(), { method: "DELETE" }),

  /** GET /projects/:id/members — danh sách thành viên (read:project, cùng data-scope với detail). */
  listMembers: (id: string): Promise<MemberResponseDto[]> =>
    apiFetch(`/projects/${id}/members`, z.array(memberResponseSchema)),

  /** POST /projects/:id/members — thêm thành viên (manage-member:project, sensitive). */
  addMember: (id: string, body: AddMemberRequest): Promise<MemberResponseDto> =>
    apiFetch(`/projects/${id}/members`, memberResponseSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /** PATCH /projects/:id/members/:memberId — đổi vai trò (manage-member:project, sensitive). */
  updateMemberRole: (
    id: string,
    memberId: string,
    body: UpdateMemberRoleRequest,
  ): Promise<MemberResponseDto> =>
    apiFetch(`/projects/${id}/members/${memberId}`, memberResponseSchema, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  /** DELETE /projects/:id/members/:memberId — soft-remove (manage-member:project, sensitive, 204). */
  removeMember: (id: string, memberId: string): Promise<void> =>
    apiFetch(`/projects/${id}/members/${memberId}`, z.void(), { method: "DELETE" }),
};
