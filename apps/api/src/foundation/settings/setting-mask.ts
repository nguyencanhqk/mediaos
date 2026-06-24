/**
 * S1-FND-SETTING-1 — masking/lọc DTO RA cho settings (BẤT BIẾN #3, API-09 §10.3 BV3/BV4). DÙNG CHUNG cho
 * public + resolve + patch response — TUYỆT ĐỐI KHÔNG để secret_ref / raw secret / is_encrypted value lọt ra.
 *
 * Quy tắc (fail-closed):
 *  - secret_ref KHÔNG BAO GIỜ xuất hiện trong response shape (không có field này — drop tận gốc, không mask).
 *  - is_sensitive=true HOẶC is_encrypted=true HOẶC value_type='SecretRef' ⇒ value bị MASK ('***') hoặc
 *    bị LOẠI khỏi response tuỳ ngữ cảnh; caller KHÔNG nhận raw value.
 *  - chỉ trả các trường an toàn (key/value/valueType/category/scope...) — KHÔNG bao giờ trả cột secret_ref.
 */

export const MASK_PLACEHOLDER = "***";

/** Hàng setting thô (subset cột cần để quyết định mask) — cả company_settings/system_settings. */
export interface RawSettingRow {
  settingKey: string;
  settingValue: unknown;
  valueType: string;
  category: string;
  moduleCode: string | null;
  isPublic: boolean;
  isSensitive: boolean;
  isEncrypted: boolean;
  /** secret_ref — KHÔNG bao giờ ra ngoài; chỉ dùng để PHÁT HIỆN secret (drop). */
  secretRef: string | null;
}

/** Hành setting có là secret/nhạy cảm không (value KHÔNG được trả raw). */
export function isSecretLike(row: {
  isSensitive: boolean;
  isEncrypted: boolean;
  valueType: string;
  secretRef: string | null;
}): boolean {
  return (
    row.isSensitive || row.isEncrypted || row.valueType === "SecretRef" || row.secretRef !== null
  );
}

/** DTO an toàn trả ra (KHÔNG có field secret_ref — bị drop tận gốc). */
export interface SafeSettingView {
  key: string;
  value: unknown;
  valueType: string;
  category: string;
  moduleCode: string | null;
  scope: "company" | "system" | "default";
  isSensitive: boolean;
  /** true khi value đã bị mask (sensitive/encrypted/secret). */
  masked: boolean;
}

/**
 * Map 1 hàng thô → DTO an toàn. secret/encrypted/sensitive ⇒ value='***', masked=true. secret_ref KHÔNG
 * có trong output (drop). Dùng cho RESOLVE (giữ key, mask value) khi caller có quyền thấy metadata.
 */
export function toSafeView(
  row: RawSettingRow,
  scope: "company" | "system" | "default",
): SafeSettingView {
  const secret = isSecretLike(row);
  return {
    key: row.settingKey,
    value: secret ? MASK_PLACEHOLDER : row.settingValue,
    valueType: row.valueType,
    category: row.category,
    moduleCode: row.moduleCode,
    scope,
    isSensitive: row.isSensitive,
    masked: secret,
  };
}

/**
 * Lọc cho GET /public: CHỈ is_public=true AND is_sensitive=false AND KHÔNG secret-like ⇒ map key→value AN
 * TOÀN. Bất cứ hàng nào secret-like (kể cả lỡ is_public=true) BỊ LOẠI hoàn toàn (KHÔNG trả masked — public
 * không bao giờ có dấu vết secret). Trả map { key: value }.
 */
export function toPublicMap(rows: RawSettingRow[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const row of rows) {
    if (!row.isPublic) continue;
    if (row.isSensitive) continue;
    if (isSecretLike(row)) continue; // double-guard: encrypted/SecretRef/secret_ref → drop
    out[row.settingKey] = row.settingValue;
  }
  return out;
}

/**
 * AUDIT-safe snapshot của 1 hàng setting cho old/new_values (PATCH). KHÔNG đưa secret_ref vào (AuditService
 * cũng mask, nhưng drop-at-source là phòng thủ chiều sâu — BẤT BIẾN #3). Chỉ field cấu hình + cờ.
 */
export function toAuditSnapshot(row: {
  settingKey: string;
  settingValue: unknown;
  valueType: string;
  category: string;
  moduleCode: string | null;
  isPublic: boolean;
  isSensitive: boolean;
  isEncrypted: boolean;
  status: string;
}): Record<string, unknown> {
  const secret = row.isSensitive || row.isEncrypted || row.valueType === "SecretRef";
  return {
    settingKey: row.settingKey,
    settingValue: secret ? MASK_PLACEHOLDER : row.settingValue,
    valueType: row.valueType,
    category: row.category,
    moduleCode: row.moduleCode,
    isPublic: row.isPublic,
    isSensitive: row.isSensitive,
    isEncrypted: row.isEncrypted,
    status: row.status,
  };
}
