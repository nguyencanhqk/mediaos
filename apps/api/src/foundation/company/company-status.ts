import { ForbiddenException } from "@nestjs/common";

/**
 * S1-FND-MODULE-1 — company status gate (allow-list, fail-closed).
 *
 * `companies_status_chk` (mig 0002) = ('active','suspended') CHỮ THƯỜNG. Dùng ALLOW-LIST `=== 'active'`
 * (KHÔNG deny-list 'suspended') để mọi trạng thái tương lai (vd 'inactive'/'deleted') mặc định bị chặn ghi —
 * mirror auth-path (auth-status-guard: login/refresh chỉ cho status==='active'). BACKEND-04 §8.1 rule 1:
 * company Suspended ⇒ user KHÔNG được tiếp tục thao tác nghiệp vụ (áp cho GHI; ĐỌC current vẫn cho để FE
 * render trạng thái suspended).
 */
export function isCompanyActive(status: string | null | undefined): boolean {
  return status === "active";
}

/** Ép company active TRƯỚC mọi ghi nghiệp vụ. Không active → 403 (KHÔNG ghi, KHÔNG audit). */
export function assertCompanyActive(status: string | null | undefined): void {
  if (!isCompanyActive(status)) {
    throw new ForbiddenException("Công ty đang bị tạm ngưng — không thể thực hiện thao tác này.");
  }
}
