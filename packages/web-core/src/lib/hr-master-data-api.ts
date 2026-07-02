import { z } from "zod";
import {
  positionSchema,
  jobLevelSchema,
  contractTypeSchema,
  type PositionDto,
  type CreatePositionRequest,
  type UpdatePositionRequest,
  type JobLevelDto,
  type CreateJobLevelRequest,
  type UpdateJobLevelRequest,
  type ContractTypeDto,
  type CreateContractTypeRequest,
  type UpdateContractTypeRequest,
  type CreateDepartmentRequest,
  type UpdateDepartmentRequest,
} from "@mediaos/contracts";
import { apiFetch } from "./api-client";
import { buildQueryString } from "./api-params";

/**
 * HR master-data API client — S2-FE-HR-5 (lane HR5-WC).
 *
 * Nối 4 nhóm màn quản trị dữ liệu gốc HR:
 * - Departments  GET/POST/PATCH/DELETE /hr/departments            (cặp read/create/update/delete:department)
 * - Positions    GET/POST/PATCH/DELETE /org/positions             (cặp read/create/update/delete:position)
 * - Job levels   GET/POST/PATCH/DELETE /hr/master-data/job-levels (cặp DUY NHẤT manage:master-data)
 * - Contract types GET/POST/PATCH/DELETE /hr/master-data/contract-types (cặp DUY NHẤT manage:master-data)
 *
 * BẤT BIẾN: company_id do SERVER resolve từ auth context — client KHÔNG gửi/forward.
 * Response validate Zod ở ranh giới (schema @mediaos/contracts). Permission gate là việc của SERVER
 * (@RequirePermission) → 403 khi thiếu cặp; FE gate hiển thị qua registry/PermissionGate (KHÔNG cổng thật).
 * DELETE là SOFT-DELETE server-side (deleted_at) trả 204 — apiFetch parse 204 → undefined.
 */

// ── Department read schema (org_unit subset) ───────────────────────────────────
// Không có contract read riêng cho department (contracts chỉ có create/update input); dựng schema đọc
// tại ranh giới khớp SHAPE repo trả (hr-department.repository listDepartments/findById + .returning()).
// z.object mặc định strip key thừa (type/deletedAt của .returning()) → an toàn cho mọi biến thể response.
const hrDepartmentSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  parentId: z.string().uuid().nullable(),
  name: z.string(),
  code: z.string().nullable(),
  description: z.string().nullable(),
  headUserId: z.string().uuid().nullable(),
  status: z.enum(["active", "inactive"]),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type HrDepartment = z.infer<typeof hrDepartmentSchema>;

export const hrMasterDataApi = {
  // ── Departments (/hr/departments) ────────────────────────────────────────────

  /** GET /hr/departments — danh sách phòng ban. Permission: read:department. */
  listDepartments: (status?: string): Promise<HrDepartment[]> =>
    apiFetch(
      `/hr/departments${buildQueryString(status ? { status } : {})}`,
      z.array(hrDepartmentSchema),
    ),

  /** GET /hr/departments/:id — chi tiết. Permission: read:department. */
  getDepartment: (id: string): Promise<HrDepartment> =>
    apiFetch(`/hr/departments/${id}`, hrDepartmentSchema),

  /** POST /hr/departments — tạo phòng ban. Permission: create:department. */
  createDepartment: (body: CreateDepartmentRequest): Promise<HrDepartment> =>
    apiFetch("/hr/departments", hrDepartmentSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /** PATCH /hr/departments/:id — cập nhật. Permission: update:department. */
  updateDepartment: (id: string, body: UpdateDepartmentRequest): Promise<HrDepartment> =>
    apiFetch(`/hr/departments/${id}`, hrDepartmentSchema, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  /** DELETE /hr/departments/:id — soft-delete (204). Permission: delete:department. */
  deleteDepartment: (id: string): Promise<void> =>
    apiFetch(`/hr/departments/${id}`, z.void(), { method: "DELETE" }),

  // ── Positions (/org/positions) ───────────────────────────────────────────────

  /** GET /org/positions — danh sách chức vụ. Permission: read:position. */
  listPositions: (orgUnitId?: string): Promise<PositionDto[]> =>
    apiFetch(
      `/org/positions${buildQueryString(orgUnitId ? { orgUnitId } : {})}`,
      z.array(positionSchema),
    ),

  /** GET /org/positions/:id — chi tiết. Permission: read:position. */
  getPosition: (id: string): Promise<PositionDto> =>
    apiFetch(`/org/positions/${id}`, positionSchema),

  /** POST /org/positions — tạo chức vụ. Permission: create:position. */
  createPosition: (body: CreatePositionRequest): Promise<PositionDto> =>
    apiFetch("/org/positions", positionSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /** PATCH /org/positions/:id — cập nhật. Permission: update:position. */
  updatePosition: (id: string, body: UpdatePositionRequest): Promise<PositionDto> =>
    apiFetch(`/org/positions/${id}`, positionSchema, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  /** DELETE /org/positions/:id — soft-delete (204). Permission: delete:position. */
  deletePosition: (id: string): Promise<void> =>
    apiFetch(`/org/positions/${id}`, z.void(), { method: "DELETE" }),

  // ── Job levels (/hr/master-data/job-levels) — cặp DUY NHẤT manage:master-data ─

  /** GET /hr/master-data/job-levels — danh sách cấp bậc. Permission: manage:master-data. */
  listJobLevels: (status?: string): Promise<JobLevelDto[]> =>
    apiFetch(
      `/hr/master-data/job-levels${buildQueryString(status ? { status } : {})}`,
      z.array(jobLevelSchema),
    ),

  /** GET /hr/master-data/job-levels/:id — chi tiết. Permission: manage:master-data. */
  getJobLevel: (id: string): Promise<JobLevelDto> =>
    apiFetch(`/hr/master-data/job-levels/${id}`, jobLevelSchema),

  /** POST /hr/master-data/job-levels — tạo cấp bậc. Permission: manage:master-data. */
  createJobLevel: (body: CreateJobLevelRequest): Promise<JobLevelDto> =>
    apiFetch("/hr/master-data/job-levels", jobLevelSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /** PATCH /hr/master-data/job-levels/:id — cập nhật. Permission: manage:master-data. */
  updateJobLevel: (id: string, body: UpdateJobLevelRequest): Promise<JobLevelDto> =>
    apiFetch(`/hr/master-data/job-levels/${id}`, jobLevelSchema, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  /** DELETE /hr/master-data/job-levels/:id — soft-delete (204). Permission: manage:master-data. */
  deleteJobLevel: (id: string): Promise<void> =>
    apiFetch(`/hr/master-data/job-levels/${id}`, z.void(), { method: "DELETE" }),

  // ── Contract types (/hr/master-data/contract-types) — cặp DUY NHẤT manage:master-data ─

  /** GET /hr/master-data/contract-types — danh sách loại hợp đồng. Permission: manage:master-data. */
  listContractTypes: (status?: string): Promise<ContractTypeDto[]> =>
    apiFetch(
      `/hr/master-data/contract-types${buildQueryString(status ? { status } : {})}`,
      z.array(contractTypeSchema),
    ),

  /** GET /hr/master-data/contract-types/:id — chi tiết. Permission: manage:master-data. */
  getContractType: (id: string): Promise<ContractTypeDto> =>
    apiFetch(`/hr/master-data/contract-types/${id}`, contractTypeSchema),

  /** POST /hr/master-data/contract-types — tạo. Permission: manage:master-data. */
  createContractType: (body: CreateContractTypeRequest): Promise<ContractTypeDto> =>
    apiFetch("/hr/master-data/contract-types", contractTypeSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /** PATCH /hr/master-data/contract-types/:id — cập nhật. Permission: manage:master-data. */
  updateContractType: (id: string, body: UpdateContractTypeRequest): Promise<ContractTypeDto> =>
    apiFetch(`/hr/master-data/contract-types/${id}`, contractTypeSchema, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  /** DELETE /hr/master-data/contract-types/:id — soft-delete (204). Permission: manage:master-data. */
  deleteContractType: (id: string): Promise<void> =>
    apiFetch(`/hr/master-data/contract-types/${id}`, z.void(), { method: "DELETE" }),
};
