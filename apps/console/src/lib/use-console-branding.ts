import { useQuery } from "@tanstack/react-query";
import type { CompanyBranding } from "@mediaos/contracts";
import { brandingApi, foundationKeys, useAuthStore } from "@mediaos/web-core";

/**
 * S5-BRAND-FE-2 — thương hiệu công ty cho apps/console (chỉ dùng cho favicon động).
 *
 * Mirror `apps/app/src/hooks/use-branding.ts` — cùng endpoint, cùng queryKey, cùng chính sách staleTime.
 * KHÔNG gộp vào web-core vì package đó không có `@tanstack/react-query` trong dependencies (xem
 * docstring useFavicon); hai app tự sở hữu query của mình, hook DOM thì dùng chung.
 *
 * `GET /foundation/company/branding` là authenticated-only ⇒ mọi user console đọc được. FAIL-SOFT:
 * lỗi → data undefined → useFavicon giữ favicon tĩnh.
 */
export function useConsoleBranding() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  return useQuery<CompanyBranding>({
    queryKey: foundationKeys.company.branding(),
    queryFn: () => brandingApi.getBranding(),
    enabled: isAuthenticated,
    staleTime: 60_000,
    retry: false,
  });
}
