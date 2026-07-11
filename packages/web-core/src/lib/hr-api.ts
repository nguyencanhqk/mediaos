import { z } from "zod";
import {
  hrEmployeeListResponseSchema,
  hrEmployeeDetailSchema,
  hrEmployeeSummarySchema,
  hrMeProfileSchema,
  hrDepartmentLookupSchema,
  hrPositionLookupSchema,
  hrJobLevelLookupSchema,
  hrContractTypeLookupSchema,
  createHrEmployeeResponseSchema,
  updateHrEmployeeResponseSchema,
  profileChangeRequestListResponseSchema,
  profileChangeRequestDetailSchema,
  type HrEmployeeListQuery,
  type HrEmployeeListResponse,
  type HrEmployeeDetail,
  type HrEmployeeSummary,
  type HrMeProfile,
  type HrDepartmentLookup,
  type HrPositionLookup,
  type HrJobLevelLookup,
  type HrContractTypeLookup,
  type CreateHrEmployeeRequest,
  type CreateHrEmployeeResponse,
  type UpdateHrEmployeeRequest,
  type UpdateHrEmployeeResponse,
  type CreateProfileChangeRequest,
  type ApproveProfileChangeRequest,
  type ProfileChangeRequestListQuery,
  type ProfileChangeRequestListResponse,
  type ProfileChangeRequestDetail,
  type HrEmployeeExportQuery,
} from "@mediaos/contracts";
import { apiFetch, apiFetchBlob, type ApiBlobResult } from "./api-client";
import { buildQueryString } from "./api-params";

/**
 * HR API client — S2-FE-HR-1. Tất cả endpoint cần Bearer (apiFetch gắn tự động).
 * Masking (salary/PII) là việc của server — client chỉ render gì nhận được.
 */
export const hrApi = {
  /**
   * GET /hr/employees — danh sách nhân viên có phân trang + filter + search.
   * Server trả envelope { success, data: { items, meta } }; apiFetch unwrap → items+meta.
   */
  listEmployees: (query?: Partial<HrEmployeeListQuery>): Promise<HrEmployeeListResponse> => {
    const qs = buildQueryString(query ?? {});
    return apiFetch(`/hr/employees${qs}`, hrEmployeeListResponseSchema);
  },

  /**
   * GET /hr/employees/summary — HR-PROFILE-UI-1: headcount tổng quan (theo scope của caller).
   * byGender null khi thiếu view-sensitive:employee — server mask, FE ẩn donut.
   */
  getEmployeeSummary: (): Promise<HrEmployeeSummary> =>
    apiFetch("/hr/employees/summary", hrEmployeeSummarySchema),

  /**
   * GET /hr/employees/export — xuất CSV danh bạ nhân sự (HR-PROFILE-UI-2, HR.EMPLOYEE.EXPORT).
   *
   * Cặp NHẠY CẢM `export:employee` (mig 0491, is_sensitive → fail-closed). Data-scope (Own/Team/Company)
   * do SERVER áp TRƯỚC kết xuất — client KHÔNG forward company_id; masking PII per-row (view-sensitive)
   * cũng là việc của server (cột thiếu quyền → ô rỗng). Server cap HR_EMPLOYEE_EXPORT_MAX_ROWS → 422 khi
   * vượt (KHÔNG cắt im lặng). Trả nhị phân qua apiFetchBlob (refresh-on-401 replay 1 lần) — { blob, filename }.
   * Lỗi HTTP (403/422/500) ném ApiError → caller hiện thông điệp người-đọc, KHÔNG tải file lỗi.
   */
  exportEmployees: (query?: HrEmployeeExportQuery): Promise<ApiBlobResult> =>
    apiFetchBlob(`/hr/employees/export${buildQueryString(query ?? {})}`),

  /**
   * GET /hr/employees/:id — chi tiết hồ sơ nhân viên.
   * Sensitive field (baseSalary/phone/contractType/notes) null khi thiếu quyền — server mask.
   */
  getEmployee: (id: string): Promise<HrEmployeeDetail> =>
    apiFetch(`/hr/employees/${id}`, hrEmployeeDetailSchema),

  /**
   * GET /hr/me/profile — hồ sơ cá nhân của user hiện tại.
   * Own-scope: server trả 404 nếu user chưa liên kết employee.
   */
  getMyProfile: (): Promise<HrMeProfile> => apiFetch("/hr/me/profile", hrMeProfileSchema),

  /**
   * GET /hr/lookups/departments — danh sách phòng ban (non-sensitive reference data).
   */
  listDepartments: (): Promise<HrDepartmentLookup[]> =>
    apiFetch("/hr/lookups/departments", z.array(hrDepartmentLookupSchema)),

  /**
   * GET /hr/lookups/positions — danh sách chức vụ.
   */
  listPositions: (): Promise<HrPositionLookup[]> =>
    apiFetch("/hr/lookups/positions", z.array(hrPositionLookupSchema)),

  /**
   * GET /hr/lookups/job-levels — danh sách cấp bậc (gated `manage:master-data`).
   */
  listJobLevels: (): Promise<HrJobLevelLookup[]> =>
    apiFetch("/hr/lookups/job-levels", z.array(hrJobLevelLookupSchema)),

  /**
   * GET /hr/lookups/contract-types — danh sách loại hợp đồng (gated `manage:master-data`).
   */
  listContractTypes: (): Promise<HrContractTypeLookup[]> =>
    apiFetch("/hr/lookups/contract-types", z.array(hrContractTypeLookupSchema)),

  /**
   * POST /hr/employees — tạo hồ sơ nhân viên (S2-HR-BE-2).
   * Body validate `createHrEmployeeSchema` ở caller; server gate `create:employee` (403 trước handler).
   */
  createEmployee: (body: CreateHrEmployeeRequest): Promise<CreateHrEmployeeResponse> =>
    apiFetch("/hr/employees", createHrEmployeeResponseSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /**
   * PATCH /hr/employees/:id — cập nhật trường cấu trúc (KHÔNG status / link-user).
   * Server gate `update:employee`; trả id + changedFields.
   */
  updateEmployee: (id: string, body: UpdateHrEmployeeRequest): Promise<UpdateHrEmployeeResponse> =>
    apiFetch(`/hr/employees/${id}`, updateHrEmployeeResponseSchema, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  // ── Profile change request (S2-FE-HR-4 · S2-HR-BE-4, API-03 §16.7) ──────────────
  // create:profile-change-request (Own, all roles) · approve:profile-change-request (Company, hr/company-admin).

  /**
   * POST /hr/profile-change-requests — employee tự gửi yêu cầu sửa hồ sơ (Own scope).
   */
  createProfileChangeRequest: (
    body: CreateProfileChangeRequest,
  ): Promise<{ id: string; status: string }> =>
    apiFetch(
      "/hr/profile-change-requests",
      z.object({ id: z.string().uuid(), status: z.string() }),
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    ),

  /**
   * GET /hr/profile-change-requests/me — danh sách yêu cầu CỦA CHÍNH user hiện tại.
   */
  listMyProfileChangeRequests: (
    query?: Partial<Omit<ProfileChangeRequestListQuery, "employeeId">>,
  ): Promise<ProfileChangeRequestListResponse> => {
    const qs = buildQueryString(query ?? {});
    return apiFetch(`/hr/profile-change-requests/me${qs}`, profileChangeRequestListResponseSchema);
  },

  /**
   * GET /hr/profile-change-requests — HR/Admin xem danh sách theo scope Company (approve:profile-change-request).
   */
  listProfileChangeRequests: (
    query?: Partial<ProfileChangeRequestListQuery>,
  ): Promise<ProfileChangeRequestListResponse> => {
    const qs = buildQueryString(query ?? {});
    return apiFetch(`/hr/profile-change-requests${qs}`, profileChangeRequestListResponseSchema);
  },

  /**
   * GET /hr/profile-change-requests/:id — chi tiết (Own-scope ở server: chỉ chủ yêu cầu xem được — BE
   * `getRequestDetail` cố ý KHÔNG mở cho HR xem yêu cầu người khác qua route này, xem
   * profile-change-request.service.ts). HR duyệt/từ chối trực tiếp bằng id lấy từ danh sách.
   */
  getProfileChangeRequestDetail: (id: string): Promise<ProfileChangeRequestDetail> =>
    apiFetch(`/hr/profile-change-requests/${id}`, profileChangeRequestDetailSchema),

  /**
   * POST /hr/profile-change-requests/:id/approve — HR duyệt (approve:profile-change-request).
   */
  approveProfileChangeRequest: (
    id: string,
    body?: ApproveProfileChangeRequest,
  ): Promise<{ id: string; status: string }> =>
    apiFetch(
      `/hr/profile-change-requests/${id}/approve`,
      z.object({ id: z.string().uuid(), status: z.string() }),
      { method: "POST", body: JSON.stringify(body ?? {}) },
    ),

  /**
   * POST /hr/profile-change-requests/:id/reject — HR từ chối; rejectionReason bắt buộc (HR-ERR-042).
   */
  rejectProfileChangeRequest: (
    id: string,
    rejectionReason: string,
  ): Promise<{ id: string; status: string }> =>
    apiFetch(
      `/hr/profile-change-requests/${id}/reject`,
      z.object({ id: z.string().uuid(), status: z.string() }),
      { method: "POST", body: JSON.stringify({ rejectionReason }) },
    ),

  /**
   * POST /hr/profile-change-requests/:id/cancel — employee tự hủy yêu cầu của mình khi còn Pending.
   */
  cancelProfileChangeRequest: (id: string): Promise<{ id: string; status: string }> =>
    apiFetch(
      `/hr/profile-change-requests/${id}/cancel`,
      z.object({ id: z.string().uuid(), status: z.string() }),
      { method: "POST" },
    ),
};
