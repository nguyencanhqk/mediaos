import { z } from "zod";
import { companyViewSchema, type CompanyView } from "@mediaos/contracts";
import { apiFetch } from "./api-client";

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
