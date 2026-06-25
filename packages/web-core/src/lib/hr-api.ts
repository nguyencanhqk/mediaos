import { z } from "zod";
import {
  hrEmployeeListResponseSchema,
  hrEmployeeDetailSchema,
  hrMeProfileSchema,
  hrDepartmentLookupSchema,
  hrPositionLookupSchema,
  type HrEmployeeListQuery,
  type HrEmployeeListResponse,
  type HrEmployeeDetail,
  type HrMeProfile,
  type HrDepartmentLookup,
  type HrPositionLookup,
} from "@mediaos/contracts";
import { apiFetch } from "./api-client";
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
};
