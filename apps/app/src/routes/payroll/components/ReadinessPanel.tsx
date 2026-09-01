import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { payrollApi, payrollKeys, useCanExact } from "@mediaos/web-core";
import { PAYROLL_ENGINE_PAIRS } from "../constants";

/**
 * PAY-SCREEN-002 — hộp **cảnh báo dữ liệu thiếu** (PAYROLL-FUNC-005, SPEC-11 §14).
 *
 * ⚠️ Cảnh báo là **MỀM**: nó KHÔNG chặn nút «Tính lương». Chỉ `eligibleCount === 0` mới là cổng cứng,
 * và cổng đó nằm ở BE (422 `PAYROLL-ERR-009`) — FE hiện thêm băng đỏ để người dùng biết trước, chứ
 * không tự khoá nút. Khoá nút ở đây là dựng cổng thứ hai lệch pha với BE.
 *
 * ⚠️ Route readiness gác bằng `('calculate','payroll-period')` — cặp **GHI**, SENSITIVE. Một vai chỉ có
 * cặp ĐỌC `view-line` xem được bảng lương nhưng KHÔNG mở được hộp này: `enabled` phải theo quyền, kẻo
 * mỗi lần vào màn là một 403 câm trong console.
 *
 * `fullName` có thể `null` (ngoài vị từ chiếu danh tính) — hiện mã rút gọn, KHÔNG bịa tên.
 */
export function ReadinessPanel({ periodId }: { periodId: string }) {
  const { t } = useTranslation("payroll");

  const canRead = useCanExact(
    PAYROLL_ENGINE_PAIRS.periodReadiness.action,
    PAYROLL_ENGINE_PAIRS.periodReadiness.resourceType,
  );

  const query = useQuery({
    queryKey: payrollKeys.periods.readiness(periodId),
    queryFn: () => payrollApi.getReadiness(periodId),
    enabled: canRead,
  });

  if (!canRead) return null;
  if (query.isLoading) {
    return <div className="text-sm text-muted-foreground">{t("readiness.loading")}</div>;
  }
  if (query.isError) {
    return <div className="text-sm text-danger">{t("readiness.error")}</div>;
  }

  const data = query.data;
  if (!data) return null;

  const hasNobody = data.eligibleCount === 0;
  const warnings = data.warnings;

  if (!hasNobody && warnings.length === 0) {
    return (
      <div className="rounded-md border border-border bg-muted/40 px-4 py-3 text-sm">
        {t("readiness.allReady", { count: data.eligibleCount })}
      </div>
    );
  }

  return (
    <div
      className={`rounded-md border px-4 py-3 text-sm ${
        hasNobody ? "border-danger/40 bg-danger-muted/40" : "border-warning/40 bg-warning-muted/40"
      }`}
      data-testid="payroll-readiness"
    >
      <div className="flex items-center gap-2 font-medium">
        <AlertTriangle className="size-4" />
        {hasNobody
          ? t("readiness.noEligible")
          : t("readiness.title", { count: data.eligibleCount, warnings: warnings.length })}
      </div>
      {warnings.length > 0 && (
        <ul className="mt-2 space-y-1">
          {warnings.map((w) => (
            <li key={`${w.userId}:${w.kind}`} className="text-muted-foreground">
              {w.fullName ?? `#${w.userId.slice(0, 8)}`} — {t(`readiness.kind.${w.kind}`)}
            </li>
          ))}
        </ul>
      )}
      {!hasNobody && <p className="mt-2 text-xs">{t("readiness.softHint")}</p>}
    </div>
  );
}
