import { useQuery } from "@tanstack/react-query";
import type { CompanyBranding } from "@mediaos/contracts";
import { brandingApi, foundationKeys, useAuthStore } from "@mediaos/web-core";

/**
 * S5-BRAND-FE-2 — nguồn DUY NHẤT của thương hiệu công ty trong apps/app.
 *
 * Dùng ở CẢ vỏ app (GlobalTopbar logo + favicon động) LẪN màn quản trị /system/company. Cùng
 * `foundationKeys.company.branding()` nên chỉ MỘT request cho cả cây, và đặt logo ở màn quản trị thì
 * topbar tự cập nhật qua invalidate (không cần F5).
 *
 * `GET /foundation/company/branding` là authenticated-only (S5-BRAND-FE-2) ⇒ MỌI nhân viên đọc được,
 * không riêng company-admin. Vẫn `enabled` theo trạng thái đăng nhập để không bắn request lúc chưa có
 * phiên (boot/redirect về apps/auth).
 *
 * FAIL-SOFT: lỗi → `data` undefined; caller PHẢI có fallback (wordmark / favicon tĩnh) và KHÔNG được
 * chặn render vì nó.
 */
export function useBrandingQuery() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  return useQuery<CompanyBranding>({
    queryKey: foundationKeys.company.branding(),
    queryFn: () => brandingApi.getBranding(),
    enabled: isAuthenticated,
    // `url` (source='file') là presigned TTL ngắn (mặc định 300s). staleTime 60s << TTL ⇒ refetch cấp URL
    // tươi trước khi hết hạn. Hạ TTL server dưới ~60s thì phải chỉnh con số này.
    staleTime: 60_000,
    // Vỏ app: KHÔNG retry ồn ào — hỏng thì fallback wordmark, không đáng để thử lại nhiều lần.
    retry: false,
  });
}
