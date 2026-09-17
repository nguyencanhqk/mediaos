import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { PayrollPeriodDto, PayrollPeriodLineDto } from "@mediaos/contracts";
import { payrollApi, payrollKeys } from "@mediaos/web-core";

/**
 * `sha256("<formulaSetFingerprint>:<statutoryRateId | none>")` — mirror ĐÚNG `lineFingerprint` của
 * `apps/api/src/payroll/formula/formula.fingerprint.ts` (thứ BE-3 ghi vào `template_fingerprint` của dòng).
 */
export async function lineFingerprintFor(
  formulaSetFingerprint: string,
  statutoryRateId: string | null,
): Promise<string> {
  const bytes = new TextEncoder().encode(`${formulaSetFingerprint}:${statutoryRateId ?? "none"}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Có ít nhất một dòng tính bằng tập công thức KHÁC tập hiện tại của mẫu không. */
export async function hasTemplateDrift(
  formulaSetFingerprint: string,
  lines: readonly Pick<PayrollPeriodLineDto, "templateFingerprint" | "statutoryRateId">[],
): Promise<boolean> {
  const cache = new Map<string, string>();
  for (const line of lines) {
    if (!line.templateFingerprint) continue;
    const rateKey = line.statutoryRateId ?? "none";
    let expected = cache.get(rateKey);
    if (expected === undefined) {
      expected = await lineFingerprintFor(formulaSetFingerprint, line.statutoryRateId ?? null);
      cache.set(rateKey, expected);
    }
    if (expected !== line.templateFingerprint) return true;
  }
  return false;
}

/**
 * S15-PAYROLL-FE-2 (D11) — băng «mẫu bảng lương đã đổi sau lần tính gần nhất».
 *
 * Chỉ có nghĩa ở `Calculated` (tính lại được; từ `Reviewing` snapshot đã đóng băng) và khi caller đọc được
 * mẫu (`view:payroll-template`) — thiếu cặp ⇒ KHÔNG gọi 051, trả `false` (không đoán).
 * So trên các dòng ĐANG HIỆN (trang hiện tại) — đủ để báo; không tải thêm trang chỉ để kiểm.
 */
export function useTemplateDrift(
  period: Pick<PayrollPeriodDto, "status" | "templateId">,
  lines: readonly PayrollPeriodLineDto[],
  canViewTemplates: boolean,
): boolean {
  const templateId = period.templateId;
  const relevant =
    canViewTemplates &&
    templateId !== null &&
    period.status === "Calculated" &&
    lines.some((l) => Boolean(l.templateFingerprint));

  const templateQuery = useQuery({
    queryKey: payrollKeys.catalog.templateDetail(templateId ?? ""),
    queryFn: () => payrollApi.getPayrollTemplate(templateId ?? ""),
    enabled: relevant,
  });
  const setFp = templateQuery.data?.formulaSetFingerprint;

  const [drift, setDrift] = useState(false);
  useEffect(() => {
    if (!relevant || !setFp) {
      setDrift(false);
      return;
    }
    let cancelled = false;
    hasTemplateDrift(setFp, lines)
      .then((d) => {
        if (!cancelled) setDrift(d);
      })
      .catch(() => {
        // WebCrypto vắng (ngữ cảnh không an toàn) ⇒ không kết luận được — im băng, không báo sai.
        if (!cancelled) setDrift(false);
      });
    return () => {
      cancelled = true;
    };
  }, [relevant, setFp, lines]);

  return drift;
}
