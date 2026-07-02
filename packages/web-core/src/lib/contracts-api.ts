import { z } from "zod";
import {
  employeeContractSchema,
  type EmployeeContractDto,
  type ListContractsQuery,
  type CreateContractRequest,
  type UpdateContractRequest,
} from "@mediaos/contracts";
import { apiFetch } from "./api-client";
import { buildQueryString } from "./api-params";

/**
 * Employee contracts API client — S2-FE-HR-7 (nối S2-HR-BE-6, PR #82).
 *
 * GET /hr/contracts + /hr/employees/:id/contracts trả về qua `paginated(data, pagination)` ở BE
 * (apps/api/src/employees/contract.controller.ts) — interceptor HOIST `pagination` lên top-level
 * envelope, nhưng `apiFetch`/`unwrapEnvelope` CHỈ trích `.data` (bare array), pagination bị bỏ
 * (cùng hạn chế với GET /auth/login-logs — xem AuthLogPagination). Vì vậy client dùng heuristic
 * prev/next (items.length === limit ⇒ còn trang sau), KHÔNG có `total`.
 *
 * BẤT BIẾN: company_id do SERVER resolve từ auth context — client KHÔNG gửi/forward.
 * Masking là việc của SERVER — client chỉ render field nhận được. Permission: view:contract (đọc,
 * scope Own/Team/Company theo data-scope) · manage:contract (create/update/delete/link-file, Company-only).
 */
const contractListSchema = z.array(employeeContractSchema);

export const contractsApi = {
  /** GET /hr/contracts — toàn công ty (theo scope). */
  listContracts: (query?: Partial<ListContractsQuery>): Promise<EmployeeContractDto[]> =>
    apiFetch(`/hr/contracts${buildQueryString(query ?? {})}`, contractListSchema),

  /** GET /hr/employees/:id/contracts — hợp đồng của 1 nhân viên. */
  listEmployeeContracts: (
    employeeId: string,
    query?: Partial<ListContractsQuery>,
  ): Promise<EmployeeContractDto[]> =>
    apiFetch(
      `/hr/employees/${employeeId}/contracts${buildQueryString(query ?? {})}`,
      contractListSchema,
    ),

  /** GET /hr/contracts/:id — chi tiết 1 hợp đồng. */
  getContract: (id: string): Promise<EmployeeContractDto> =>
    apiFetch(`/hr/contracts/${id}`, employeeContractSchema),

  /** POST /hr/contracts — tạo hợp đồng. Permission: manage:contract. */
  createContract: (body: CreateContractRequest): Promise<EmployeeContractDto> =>
    apiFetch("/hr/contracts", employeeContractSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /** PATCH /hr/contracts/:id — cập nhật. Permission: manage:contract. */
  updateContract: (id: string, body: UpdateContractRequest): Promise<EmployeeContractDto> =>
    apiFetch(`/hr/contracts/${id}`, employeeContractSchema, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  /**
   * POST /hr/contracts/:id/file — gắn file hợp đồng (qua FileService, validate tenant + scan status).
   * KHÔNG set fileId trực tiếp qua create/update — endpoint này là đường ĐÚNG DUY NHẤT (server validate).
   * Permission: manage:contract.
   */
  linkContractFile: (id: string, fileId: string): Promise<EmployeeContractDto> =>
    apiFetch(`/hr/contracts/${id}/file`, employeeContractSchema, {
      method: "POST",
      body: JSON.stringify({ fileId }),
    }),

  /** DELETE /hr/contracts/:id — soft-delete (204). Permission: manage:contract. */
  deleteContract: (id: string): Promise<void> =>
    apiFetch(`/hr/contracts/${id}`, z.void(), { method: "DELETE" }),
};
