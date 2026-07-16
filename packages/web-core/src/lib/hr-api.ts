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
  hrImportReportSchema,
  hrImportResultSchema,
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
  type LinkUserRequest,
  type UnlinkUserRequest,
  type HrImportReport,
  type HrImportResult,
} from "@mediaos/contracts";
import { apiFetch, apiFetchBlob, apiFetchMultipart, type ApiBlobResult } from "./api-client";
import { buildQueryString } from "./api-params";

// S5-HR-LINKUI-1 — response POST/DELETE /hr/employees/:id/link-user (HrWriteService.linkUser/
// unlinkUser trả { id, userId }). KHÔNG có response schema riêng trong @mediaos/contracts (theo mẫu
// createProfileChangeRequest ở dưới: object nhỏ khai TẠI ĐÂY thay vì mở thêm export ở contracts).
const hrLinkUserResponseSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid().nullable(),
});

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

  // ── Link / unlink user (S5-HR-LINKUI-1, HR-FUNC-011 — BE ship S2-HR-BE-2) ────────
  // Cả 2 gate `update:employee` ở SERVER (hr-write.controller.ts) — KHÔNG cặp "link-user" riêng.

  /**
   * POST /hr/employees/:id/link-user — liên kết 1 user CÓ SẴN cùng company vào hồ sơ nhân viên (chưa
   * liên kết). Server validate: employee chưa có user (409, HR-ERR-027) + user chưa liên kết employee
   * active khác (409, HR-ERR-028) + audit action="link-user" trong transaction (BẤT BIẾN #2).
   */
  linkUser: (id: string, body: LinkUserRequest): Promise<{ id: string; userId: string | null }> =>
    apiFetch(`/hr/employees/${id}/link-user`, hrLinkUserResponseSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /**
   * DELETE /hr/employees/:id/link-user — hủy liên kết (lockUser tùy chọn khóa tài khoản vừa gỡ). Server
   * chặn tự hủy liên kết chính mình (403) + audit action="unlink-user". DELETE có body (route BE khai
   * @Body — KHÔNG phải REST thuần nhưng khớp `unlinkUserSchema` đã ship).
   */
  unlinkUser: (
    id: string,
    body: UnlinkUserRequest,
  ): Promise<{ id: string; userId: string | null }> =>
    apiFetch(`/hr/employees/${id}/link-user`, hrLinkUserResponseSchema, {
      method: "DELETE",
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

  // ── Import hàng loạt (S5-HR-IMPORT-FE-1, HR.EMPLOYEE.IMPORT / SPEC-03 §7) ────────────────────────
  // Cặp NHẠY CẢM `import:employee` (mig 0496, is_sensitive → fail-closed; grant Company CHỈ hr +
  // company-admin). BE nối S5-HR-IMPORT-BE-1 (hr-import.controller.ts, HrEmployeeImportService).

  /**
   * POST /hr/employees/import?dryRun=true — PREVIEW: validate toàn bộ file (schema từng dòng + dup-check +
   * resolve tên → id), KHÔNG ghi (KHÔNG insert, KHÔNG cấp sequence, KHÔNG audit). Multipart field "file"
   * (FileInterceptor, ≤5MB — server re-check + validate MIME/extension → 400 người-đọc, KHÔNG raw 500).
   * `hrImportReportSchema` pin `dryRun: true` — BE trả sai hình dạng (vd lỡ ghi thật) sẽ FAIL Zod-parse ở
   * đây thay vì âm thầm hiển thị nhầm. apiFetchMultipart KHÔNG set Content-Type thủ công (browser tự set
   * boundary) — ép tay sẽ làm multer BE không parse được.
   */
  previewEmployeeImport: (file: File): Promise<HrImportReport> => {
    const formData = new FormData();
    formData.append("file", file);
    return apiFetchMultipart(
      `/hr/employees/import${buildQueryString({ dryRun: true })}`,
      hrImportReportSchema,
      formData,
    );
  },

  /**
   * POST /hr/employees/import?dryRun=false — ÁP DỤNG THẬT: partial-success (mỗi dòng hợp lệ tạo trong tx
   * riêng, dòng lỗi bị bỏ qua + báo cáo, KHÔNG rollback các dòng khác), rồi ghi ĐÚNG 1 audit session
   * append-only (`employee_import`, {fileName, ok, fail} — KHÔNG PII/secret). UNLINKED: hồ sơ tạo ra
   * user_id=NULL, KHÔNG cấp tài khoản đăng nhập (liên kết là hành động riêng, HR-FUNC-011). Caller PHẢI
   * gọi hàm này CHỈ SAU KHI người dùng xem preview + bấm "Áp dụng" (KHÔNG tự động dryRun=false).
   */
  applyEmployeeImport: (file: File): Promise<HrImportResult> => {
    const formData = new FormData();
    formData.append("file", file);
    return apiFetchMultipart(
      `/hr/employees/import${buildQueryString({ dryRun: false })}`,
      hrImportResultSchema,
      formData,
    );
  },

  /**
   * GET /hr/employees/import/template — tải template CSV (header tiếng Việt + 1 dòng mẫu, BOM UTF-8 cho
   * Excel). apiFetchBlob (nhị phân, refresh-on-401 replay) — { blob, filename } (filename suy từ
   * Content-Disposition server gửi, caller fallback tên mặc định khi vắng).
   */
  downloadImportTemplate: (): Promise<ApiBlobResult> =>
    apiFetchBlob("/hr/employees/import/template"),
};
