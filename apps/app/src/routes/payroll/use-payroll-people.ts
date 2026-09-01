/**
 * S13-PAYROLL-FE-1 — bảng tra `userId → tên` cho các màn PAYROLL.
 *
 * ── VÌ SAO CẦN HOOK RIÊNG ─────────────────────────────────────────────────────────────────────────
 * DTO `payroll_period_lines`, `payslips` và `bonus_penalties` **CỐ Ý chỉ mang `userId`**, không mang
 * tên: tên người là cột danh tính phải đi qua điểm chiếu DUY NHẤT `PayrollPeopleRepository` (SPEC-11
 * §18), và `payrollLineListQuerySchema` còn bỏ hẳn tham số `q` vì lọc-theo-tên trước/sau khi bọc đều
 * làm `pagination.total` đếm một tập còn `data` là tập khác. Nên FE tra tên bằng **picker 034**, không
 * bằng API HR (`payroll-officer` giữ 0 cặp ngoài PAYROLL — không gọi được API-03).
 *
 * ⚠️ Picker gác bằng `('view','salary-profile')` — cặp **SENSITIVE**, và KHÁC cặp gác bảng lương
 * (`view-line:payroll-period`). Một vai có thể xem được bảng lương mà KHÔNG mở được danh bạ. Đó là
 * trạng thái HỢP LỆ, không phải lỗi: hook trả bảng rỗng và caller rơi về `displayUserRef` (mã rút gọn)
 * thay vì trang trắng hay vòng quay vô hạn. Bật `enabled` theo quyền là bắt buộc — gọi khi thiếu quyền
 * chỉ đẻ 403 trong console mỗi lần render.
 *
 * ⚠️ Trần `limit` của picker là 100 (`PAYROLL_PICKER_LIMIT_MAX`). Công ty > 100 người thì bảng tra
 * **không phủ hết** — vì thế `displayUserRef` phải luôn có đường lùi, và KHÔNG được coi "vắng tên" là
 * "người không tồn tại".
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { payrollApi, payrollKeys, useCanExact } from "@mediaos/web-core";
import { PAYROLL_PICKER_LIMIT_MAX } from "@mediaos/contracts";
import { PAYROLL_ENGINE_PAIRS } from "./constants";

export interface PayrollPeopleLookup {
  /** `userId` → tên hiển thị đã chiếu; vắng khoá = ngoài vị từ chiếu hoặc ngoài trần picker. */
  readonly byUserId: ReadonlyMap<string, string>;
  readonly isLoading: boolean;
  /** `false` khi caller thiếu `('view','salary-profile')` — màn phải hiện mã thay vì tên, không lỗi. */
  readonly canResolve: boolean;
}

/**
 * Mã rút gọn dùng khi không tra được tên. 8 ký tự đầu của UUID là đủ để phân biệt trong một bảng, và
 * KHÔNG phải dữ liệu danh tính — an toàn với vai chỉ có cặp chở-tiền mà không có cặp danh bạ.
 */
export function displayUserRef(userId: string, lookup: PayrollPeopleLookup): string {
  return lookup.byUserId.get(userId) ?? `#${userId.slice(0, 8)}`;
}

export function usePayrollPeople(): PayrollPeopleLookup {
  const canResolve = useCanExact(
    PAYROLL_ENGINE_PAIRS.pickerPeople.action,
    PAYROLL_ENGINE_PAIRS.pickerPeople.resourceType,
  );

  const query = useQuery({
    queryKey: payrollKeys.pickers.people({ limit: PAYROLL_PICKER_LIMIT_MAX }),
    queryFn: () => payrollApi.pickerPeople({ limit: PAYROLL_PICKER_LIMIT_MAX }),
    enabled: canResolve,
    staleTime: 5 * 60 * 1000,
  });

  const byUserId = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of query.data ?? []) {
      // `fullName` NULL = ngoài vị từ chiếu ⇒ dùng mã nhân viên nếu có, KHÔNG bịa "Không rõ".
      const label = p.fullName ?? p.employeeCode;
      if (label !== null) map.set(p.userId, label);
    }
    return map;
  }, [query.data]);

  return { byUserId, isLoading: canResolve && query.isLoading, canResolve };
}
