/**
 * S2-FND-BE-1 — shape response admin module-catalog (GET /foundation/modules[/:code]). DTO cục bộ mirror
 * contracts adminModuleItemSchema (packages/contracts foundation/module-catalog). KHÁC MyAppItem: admin thấy
 * TẤT CẢ module (active + inactive) kèm cờ `enabled` resolve theo setting; KHÔNG field per-user
 * (is_favorite/is_recent/badges/allowed_actions). Trường snake_case khớp envelope interceptor (giữ nguyên data).
 */
export interface AdminModuleItem {
  module_code: string;
  name: string;
  description: string | null;
  group: string | null;
  is_active: boolean;
  /** Cờ bật/tắt resolve theo setting module.<code>.enabled (precedence company→system→default=true). */
  enabled: boolean;
  /** FE display code (MODULE.RESOURCE.ACTION) từ MODULE_APP_METADATA — KHÔNG phải cặp engine enforcement. */
  required_permissions: string[];
  /** route/icon từ MODULE_APP_METADATA; module thiếu metadata → rỗng (KHÔNG bịa). */
  route: string;
  icon: string;
}

/** Detail = cùng shape item (metadata/required_permissions/enabled). Tách tên để mở rộng độc lập. */
export type AdminModuleDetail = AdminModuleItem;
