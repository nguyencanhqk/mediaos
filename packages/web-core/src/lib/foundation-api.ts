import { z } from "zod";
import {
  companyViewSchema,
  type CompanyView,
  retentionPolicyViewSchema,
  retentionPolicyListResponseSchema,
  type RetentionPolicyView,
  type PatchRetentionPolicyDto,
  fileAccessLogListResponseSchema,
  type FileAccessLogView,
  type ListFileAccessLogsQuery,
  type FileAccessActionDto,
} from "@mediaos/contracts";
import { apiFetch } from "./api-client";
import { buildQueryString } from "./api-params";

/**
 * FOUNDATION API client — S2-FE-FND-1 (lane FND1-WC).
 *
 * Ranh giới HTTP cho màn /system (company + company settings). Mọi endpoint cần Bearer (apiFetch gắn
 * tự động). `company_id` do SERVER resolve từ AuthContext — client TUYỆT ĐỐI KHÔNG tự truyền (BẤT BIẾN #1).
 * Masking là việc của SERVER (BẤT BIẾN #3): client chỉ validate + render shape ĐÃ nhận (secret_ref không
 * bao giờ tồn tại trong response — schema dưới đây cũng không khai báo field đó).
 *
 * Cặp quyền engine (seed THẬT mig 0435 — gate ở TẦNG BE, đây chỉ chọn endpoint):
 *  - GET   /foundation/company/current      view:foundation-company
 *  - PATCH /foundation/company/current      update:foundation-company
 *  - POST  /foundation/settings/resolve     view:foundation-setting
 *  - PATCH /foundation/company-settings/:key update:foundation-setting
 *
 * Contracts: companyViewSchema tái dùng từ @mediaos/contracts. Settings resolve/company-settings CHƯA có
 * contract trong packages/contracts (deferred S1-FND-WIRE-DRIFT-1) → schema Zod boundary khai báo cục bộ
 * ở đây, mirror SafeSettingView của SettingService (KHÔNG có secret_ref).
 */

// ── value_type — mirror CHECK company_settings/system_settings (mig 0431) ────────
export const SETTING_VALUE_TYPES = [
  "String",
  "Number",
  "Boolean",
  "JSON",
  "Array",
  "SecretRef",
] as const;
export const settingValueTypeSchema = z.enum(SETTING_VALUE_TYPES);
export type SettingValueType = (typeof SETTING_VALUE_TYPES)[number];

// ── SafeSettingView — DTO an toàn RA (KHÔNG có field secret_ref — drop tận gốc ở server) ──
export const safeSettingViewSchema = z.object({
  key: z.string(),
  value: z.unknown(),
  valueType: z.string(),
  category: z.string(),
  moduleCode: z.string().nullable(),
  scope: z.enum(["company", "system", "default"]),
  isSensitive: z.boolean(),
  /** true khi value đã bị server mask ('***') — client KHÔNG bao giờ nhận raw secret. */
  masked: z.boolean(),
});
export type SafeSettingView = z.infer<typeof safeSettingViewSchema>;

/**
 * POST /resolve response — quyền-aware (server): admin (update:foundation-setting) nhận metadata đầy đủ qua
 * `settings[]` (value sensitive đã mask); user thường chỉ `values` (public-nonsensitive key→value).
 */
export const settingsResolveResponseSchema = z.union([
  z.object({ settings: z.array(safeSettingViewSchema) }),
  z.object({ values: z.record(z.string(), z.unknown()) }),
]);
export type SettingsResolveResponse = z.infer<typeof settingsResolveResponseSchema>;

// ── Public holidays (S2-FE-FND-4) ──────────────────────────────────────────────
//
// Mirror HolidayView (apps/api/src/foundation/holidays/holidays.service.ts) — boundary Zod cục bộ
// (holidays CHƯA có contract trong packages/contracts, cùng lý do settings ở trên). Cặp quyền seed THẬT
// mig 0435: view:foundation-holiday (list) / manage:foundation-holiday (create/update/delete).
// scope 'global' = holiday hệ thống (KHÔNG sửa/xoá được — CRUD chỉ áp cho scope 'company').

export const HOLIDAY_TYPES = [
  "PublicHoliday",
  "CompanyHoliday",
  "WorkingDayOverride",
  "SpecialDay",
] as const;
export const holidayTypeSchema = z.enum(HOLIDAY_TYPES);
export type HolidayType = (typeof HOLIDAY_TYPES)[number];

export const holidayViewSchema = z.object({
  id: z.string(),
  scope: z.enum(["company", "global"]),
  companyId: z.string().nullable(),
  holidayCode: z.string(),
  name: z.string(),
  holidayDate: z.string(),
  holidayType: z.string(),
  countryCode: z.string().nullable(),
  regionCode: z.string().nullable(),
  isRecurring: z.boolean(),
  affectsAttendance: z.boolean(),
  affectsLeaveCalculation: z.boolean(),
  isPaidHoliday: z.boolean(),
  status: z.string(),
  source: z.string().nullable(),
  description: z.string().nullable(),
});
export type HolidayView = z.infer<typeof holidayViewSchema>;

const holidayListSchema = z.array(holidayViewSchema);

/** GET /foundation/public-holidays query — year mặc định năm hiện tại (server tự suy khi thiếu). */
export interface HolidayListParams {
  year?: number;
  month?: number;
  countryCode?: string;
  companyOnly?: boolean;
}

/** POST /foundation/public-holidays body — chỉ tạo holiday RIÊNG CÔNG TY (server gán scope). */
export interface CreateHolidayBody {
  holidayCode: string;
  name: string;
  holidayDate: string;
  holidayType?: HolidayType;
  countryCode?: string;
  regionCode?: string;
  isRecurring?: boolean;
  affectsAttendance?: boolean;
  affectsLeaveCalculation?: boolean;
  isPaidHoliday?: boolean;
  description?: string;
}

export type UpdateHolidayBody = Partial<CreateHolidayBody>;

export interface DeleteHolidayResult {
  id: string;
  deleted: true;
}
const deleteHolidayResultSchema = z.object({ id: z.string(), deleted: z.literal(true) });

function holidayListQueryString(params?: HolidayListParams): string {
  if (!params) return "";
  const search = new URLSearchParams();
  if (params.year !== undefined) search.set("year", String(params.year));
  if (params.month !== undefined) search.set("month", String(params.month));
  if (params.countryCode) search.set("countryCode", params.countryCode);
  if (params.companyOnly !== undefined) search.set("companyOnly", String(params.companyOnly));
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

// ── Request bodies ───────────────────────────────────────────────────────────────

/** POST /foundation/settings/resolve — batch known keys (hoặc category/module). company_id KHÔNG có. */
export interface ResolveSettingsBody {
  keys?: string[];
  category?: string;
  moduleCode?: string;
  includeMetadata?: boolean;
}

/** PATCH /foundation/company-settings/:key — upsert override công ty. reason → audit. */
export interface UpdateCompanySettingBody {
  settingValue: unknown;
  valueType?: SettingValueType;
  category?: string;
  moduleCode?: string;
  description?: string;
  status?: "Active" | "Inactive";
  reason?: string;
}

/**
 * PATCH /foundation/company/current — CHỈ field hồ sơ EDITABLE (allow-list). read-only id/slug/status/
 * companyCode KHÔNG gửi; company_id KHÔNG bao giờ trong body (server lấy từ AuthContext). Partial.
 */
export type UpdateCompanyBody = Partial<
  Omit<CompanyView, "id" | "slug" | "status" | "companyCode">
>;

export const foundationApi = {
  // ── Company hiện tại ─────────────────────────────────────────────────────────

  /**
   * GET /foundation/company/current — hồ sơ công ty của tenant (resolve từ AuthContext).
   * Permission: view:foundation-company.
   */
  getCompany: (): Promise<CompanyView> =>
    apiFetch("/foundation/company/current", companyViewSchema),

  /**
   * PATCH /foundation/company/current — cập nhật hồ sơ. KHÔNG gửi company_id (server-authoritative).
   * Permission: update:foundation-company.
   */
  updateCompany: (body: UpdateCompanyBody): Promise<CompanyView> =>
    apiFetch("/foundation/company/current", companyViewSchema, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  // ── Company settings ───────────────────────────────────────────────────────

  /**
   * POST /foundation/settings/resolve — batch resolve theo keys/category/module (precedence server).
   * Permission: view:foundation-setting. Value sensitive đã MASK bởi server; secret_ref không trả.
   */
  resolveSettings: (body: ResolveSettingsBody): Promise<SettingsResolveResponse> =>
    apiFetch("/foundation/settings/resolve", settingsResolveResponseSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /**
   * PATCH /foundation/company-settings/:key — upsert override công ty cho 1 key. KHÔNG log secret.
   * Permission: update:foundation-setting. Trả SafeSettingView (masked nếu sensitive).
   */
  updateCompanySetting: (key: string, body: UpdateCompanySettingBody): Promise<SafeSettingView> =>
    apiFetch(`/foundation/company-settings/${encodeURIComponent(key)}`, safeSettingViewSchema, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
};

/**
 * holidayApi — S2-FE-FND-4. Ranh giới HTTP cho /system/public-holidays.
 * Permission (seed THẬT mig 0435): view:foundation-holiday (list) / manage:foundation-holiday (CUD).
 * company_id KHÔNG bao giờ trong body/query (server resolve từ AuthContext — BẤT BIẾN #1).
 */
export const holidayApi = {
  /** GET /foundation/public-holidays — holiday công ty + global hiệu dụng theo year/month. */
  list: (params?: HolidayListParams): Promise<HolidayView[]> =>
    apiFetch(`/foundation/public-holidays${holidayListQueryString(params)}`, holidayListSchema),

  /** POST /foundation/public-holidays — tạo holiday riêng công ty. */
  create: (body: CreateHolidayBody): Promise<HolidayView> =>
    apiFetch("/foundation/public-holidays", holidayViewSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /** PATCH /foundation/public-holidays/:id — chỉ sửa holiday riêng công ty (server chặn global). */
  update: (id: string, body: UpdateHolidayBody): Promise<HolidayView> =>
    apiFetch(`/foundation/public-holidays/${encodeURIComponent(id)}`, holidayViewSchema, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  /** DELETE /foundation/public-holidays/:id — soft-delete (BẤT BIẾN #2). */
  remove: (id: string): Promise<DeleteHolidayResult> =>
    apiFetch(`/foundation/public-holidays/${encodeURIComponent(id)}`, deleteHolidayResultSchema, {
      method: "DELETE",
    }),
};

/**
 * retentionApi — S2-FE-FND-6. Ranh giới HTTP cho /system/retention (config data-retention).
 * Permission (seed THẬT mig 0435): view:foundation-retention (list, KHÔNG sensitive) /
 * manage:foundation-retention (PATCH, is_sensitive=true — System-scope, KHÔNG tự động cấp company-admin).
 * DTO tái dùng THẲNG từ @mediaos/contracts (S2-FND-BE-3 L2) — nguồn sự thật DUY NHẤT với BE, không
 * duplicate boundary schema cục bộ (khác holidays/settings — các DTO đó predate contracts migration).
 * company_id KHÔNG bao giờ trong body (server resolve từ AuthContext — BẤT BIẾN #1).
 */
export const retentionApi = {
  /** GET /foundation/retention-policies — mọi policy tenant (kể cả disabled). */
  list: (): Promise<RetentionPolicyView[]> =>
    apiFetch("/foundation/retention-policies", retentionPolicyListResponseSchema),

  /** PATCH /foundation/retention-policies/:id — CHỈ field mutable (contract .strict() chặn leo thang). */
  update: (id: string, body: PatchRetentionPolicyDto): Promise<RetentionPolicyView> =>
    apiFetch(
      `/foundation/retention-policies/${encodeURIComponent(id)}`,
      retentionPolicyViewSchema,
      {
        method: "PATCH",
        body: JSON.stringify(body),
      },
    ),
};

/**
 * Query params GỬI ĐI cho fileAccessLogApi.list — `from`/`to` là chuỗi "yyyy-mm-dd" (từ <input type=date>,
 * KHÔNG phải Date object) vì client chỉ build QUERY STRING (KHÔNG tự Zod-parse như server); server coerce
 * sang Date qua listFileAccessLogsQuerySchema (z.coerce.date()) ở ranh giới controller. Các field khác
 * khớp ListFileAccessLogsQuery.
 */
export type FileAccessLogListParams = Omit<Partial<ListFileAccessLogsQuery>, "from" | "to"> & {
  from?: string;
  to?: string;
};

/**
 * fileAccessLogApi — S2-FE-FND-6. Ranh giới HTTP cho /system/file-access-logs (viewer, APPEND-ONLY).
 * Permission (seed THẬT mig 0435): view:foundation-file-access-log (KHÔNG sensitive, company-admin có sẵn).
 * BẤT BIẾN #2: KHÔNG có method create/update/delete — server chỉ có route GET (revoked UPDATE/DELETE ở
 * mig 0433). Field nhạy cảm (storage_path/signed-url/ip/user-agent/metadata) đã WHITELIST-loại ở contract
 * — client KHÔNG thể render field đó dù có cố (BẤT BIẾN #3).
 */
export const fileAccessLogApi = {
  /** GET /foundation/file-access-logs — masked + phân trang + filter fileId/actorUserId/action/from-to. */
  list: (params?: FileAccessLogListParams): Promise<FileAccessLogView[]> =>
    apiFetch(
      `/foundation/file-access-logs${buildQueryString(params as Record<string, unknown>)}`,
      fileAccessLogListResponseSchema,
    ),
};

export type {
  RetentionPolicyView,
  PatchRetentionPolicyDto,
  FileAccessLogView,
  FileAccessActionDto,
};
export { CLEANUP_ACTIONS, cleanupActionSchema, FILE_ACCESS_ACTIONS } from "@mediaos/contracts";
