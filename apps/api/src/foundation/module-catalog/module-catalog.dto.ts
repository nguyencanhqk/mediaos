/**
 * S1-FND-MODULE-1 — shape response `my-apps` (BACKEND-04 §9.3). DTO cục bộ; contracts Zod chính thức =
 * S1-FND-WIRE-1. Trường snake_case khớp ví dụ spec (envelope interceptor giữ nguyên data).
 */
export interface MyAppItem {
  module_code: string;
  name: string;
  description: string | null;
  route: string;
  icon: string;
  group: string | null;
  is_active: boolean;
  is_favorite: boolean;
  is_recent: boolean;
  badges: string[];
  /** FE display code (MODULE.RESOURCE.ACTION) — KHÔNG phải cặp engine enforcement. */
  required_permissions: string[];
  allowed_actions: string[];
}
