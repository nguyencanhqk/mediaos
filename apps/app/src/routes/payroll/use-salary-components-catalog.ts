import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { payrollApi, payrollKeys, useCanExact } from "@mediaos/web-core";
import type { SalaryComponentDto } from "@mediaos/contracts";
import { PAYROLL_ENGINE_PAIRS, SALARY_COMPONENT_CATALOG_PAGE } from "./constants";

export interface SalaryComponentsCatalog {
  /** Chỉ thành phần `valueType = 'profile_item'` đang dùng — thứ DUY NHẤT `items[]` được tham chiếu. */
  readonly options: readonly SalaryComponentDto[];
  /** `false` khi thiếu `('view','salary-component')` — form KHÔNG hiện bảng phụ cấp, không gửi `items`. */
  readonly canResolve: boolean;
  readonly isLoading: boolean;
  readonly isError: boolean;
  /** Catalog vượt trần một trang — picker có thể THIẾU mã, phải nói ra chứ không im. */
  readonly isTruncated: boolean;
}

/**
 * S15-PAYROLL-FE-1 — catalog thành phần lương cho picker `items[]` của form hồ sơ lương v2
 * (PAYROLL-API-044, cặp `view:salary-component` — SENSITIVE ⇒ `useCanExact`).
 *
 * ⚠️ Query 044 KHÔNG lọc được `valueType` ⇒ lọc `profile_item` Ở ĐÂY. Server từ chối 422 `PAYROLL-ERR-018`
 * mã ngoài loại đó (contracts `salaryProfileItemInputSchema`) — picker chỉ liệt kê thứ server nhận để
 * người dùng không chọn rồi ăn lỗi.
 *
 * ⚠️ Thiếu cặp catalog KHÔNG chặn tạo phiên bản lương (hai cặp khác resource, SPEC-11 §11.3 ghi chú 7
 * không ràng `manage:salary-profile ⇒ view:salary-component`) — form vẫn gửi được `baseSalary`, chỉ
 * không có bảng phụ cấp (và KHÔNG gửi khoá `items`).
 */
export function useSalaryComponentsCatalog(enabled = true): SalaryComponentsCatalog {
  const canResolve = useCanExact(
    PAYROLL_ENGINE_PAIRS.componentList.action,
    PAYROLL_ENGINE_PAIRS.componentList.resourceType,
  );
  const params = { isActive: true, page: 1, per_page: SALARY_COMPONENT_CATALOG_PAGE };
  const query = useQuery({
    queryKey: payrollKeys.catalog.components(params),
    queryFn: () => payrollApi.listSalaryComponents(params),
    enabled: enabled && canResolve,
    staleTime: 5 * 60 * 1000,
  });

  const options = useMemo(
    () => (query.data?.data ?? []).filter((c) => c.valueType === "profile_item"),
    [query.data],
  );
  const total = query.data?.pagination?.total;

  return {
    options,
    canResolve,
    isLoading: canResolve && query.isLoading,
    isError: query.isError,
    isTruncated: total !== undefined && total > SALARY_COMPONENT_CATALOG_PAGE,
  };
}

export interface SalaryComponentsFullCatalog {
  /** MỌI thành phần (kể cả ngưng dùng — công thức vẫn có thể đang tham chiếu chúng), sắp theo `sortOrder`. */
  readonly components: readonly SalaryComponentDto[];
  /** Mã của `components` — nguồn tô màu + gợi ý của `FormulaEditor`. */
  readonly codes: readonly string[];
  readonly canResolve: boolean;
  readonly isLoading: boolean;
  readonly isTruncated: boolean;
}

/**
 * S15-PAYROLL-FE-2 — catalog ĐẦY ĐỦ (không lọc `valueType`/`isActive`) cho editor công thức (gợi ý + tô màu)
 * và picker «thêm thành phần» của mẫu bảng lương. Cùng cặp gác 044 (`view:salary-component`, SENSITIVE).
 *
 * Mã ngoài danh sách này chỉ bị TÔ ĐỎ ở editor — đúng/sai vẫn do server nói (048/422); catalog vượt trần
 * một trang thì `isTruncated` để màn nói ra thay vì im lặng tô đỏ mã có thật.
 */
export function useSalaryComponentsFullCatalog(enabled = true): SalaryComponentsFullCatalog {
  const canResolve = useCanExact(
    PAYROLL_ENGINE_PAIRS.componentList.action,
    PAYROLL_ENGINE_PAIRS.componentList.resourceType,
  );
  const params = { page: 1, per_page: SALARY_COMPONENT_CATALOG_PAGE };
  const query = useQuery({
    queryKey: payrollKeys.catalog.components(params),
    queryFn: () => payrollApi.listSalaryComponents(params),
    enabled: enabled && canResolve,
    staleTime: 60 * 1000,
  });
  const components = useMemo(
    () => [...(query.data?.data ?? [])].sort((a, b) => a.sortOrder - b.sortOrder),
    [query.data],
  );
  const codes = useMemo(() => components.map((c) => c.code), [components]);
  const total = query.data?.pagination?.total;
  return {
    components,
    codes,
    canResolve,
    isLoading: canResolve && query.isLoading,
    isTruncated: total !== undefined && total > SALARY_COMPONENT_CATALOG_PAGE,
  };
}
