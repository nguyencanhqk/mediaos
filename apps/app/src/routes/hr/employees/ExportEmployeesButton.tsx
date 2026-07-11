/**
 * ExportEmployeesButton — nút "Xuất file" danh bạ nhân sự (HR-PROFILE-UI-2, HR.EMPLOYEE.EXPORT).
 *
 * Gate: useCanExact('export','employee') — cặp NHẠY CẢM (mig 0491 is_sensitive) nên PHẢI dùng exact-match
 * fail-closed (mirror ExportAttendanceButton), KHÔNG dùng <PermissionGate>/useCan wildcard-aware: user chỉ
 * có `*:*` KHÔNG được thấy nút — khớp BE fail-closed, tránh FE-permit/BE-403 mismatch. Thiếu cap exact →
 * return null (nút KHÔNG render). Server vẫn là cổng thật (403 nếu bị gọi trực tiếp).
 *
 * Tải nhị phân qua hrApi.exportEmployees → apiFetchBlob (refresh-on-401 replay). Có loading (disabled +
 * spinner) + error (inline alert người-đọc); server áp data-scope (Own/Team/Company) + mask PII per-row +
 * cap HR_EMPLOYEE_EXPORT_MAX_ROWS (422 vượt cap → hiện lỗi, KHÔNG tải file cắt im lặng).
 *
 * Masking (PII/lương) là việc của SERVER — CSV chỉ chứa gì server trả.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Download, Loader2 } from "lucide-react";
import { hrApi, useCanExact, mapApiErrorToUi } from "@mediaos/web-core";
import type { HrEmployeeExportQuery } from "@mediaos/contracts";
import { Button } from "@mediaos/ui";
import { triggerBlobDownload } from "./download-blob";

/** Cặp engine NHẠY CẢM cho gate exact (khớp HR_PERMS.EMPLOYEE.EXPORT + seed mig 0491). */
const EXPORT_EMPLOYEE = { action: "export", resourceType: "employee" } as const;

const DEFAULT_EXPORT_FILENAME = "nhan-su.csv";

interface ExportEmployeesButtonProps {
  /** Bộ lọc hiện tại của danh sách (search/orgUnitId/status/sort/order) — export theo cùng phạm vi đang xem. */
  query: HrEmployeeExportQuery;
  /** Tên file dự phòng khi server KHÔNG gửi Content-Disposition. */
  fallbackFilename?: string;
}

export function ExportEmployeesButton({ query, fallbackFilename }: ExportEmployeesButtonProps) {
  const { t } = useTranslation("hr");
  const canExport = useCanExact(EXPORT_EMPLOYEE.action, EXPORT_EMPLOYEE.resourceType);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleExport(): Promise<void> {
    setIsExporting(true);
    setError(null);
    try {
      const { blob, filename } = await hrApi.exportEmployees(query);
      triggerBlobDownload(blob, filename ?? fallbackFilename ?? DEFAULT_EXPORT_FILENAME);
    } catch (e) {
      // 403/422(vượt cap)/500 → thông điệp người-đọc; KHÔNG tải file lỗi.
      setError(mapApiErrorToUi(e).message);
    } finally {
      setIsExporting(false);
    }
  }

  // Cặp NHẠY CẢM — không có cap exact `export:employee` → nút KHÔNG render (useCanExact fail-closed:
  // `*:*`/wildcard KHÔNG mở cổng; server vẫn 403 nếu bị gọi trực tiếp).
  if (!canExport) return null;

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="outline"
        size="sm"
        onClick={() => void handleExport()}
        disabled={isExporting}
        data-testid="export-employees-button"
      >
        {isExporting ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <Download className="mr-2 h-4 w-4" aria-hidden />
        )}
        {isExporting
          ? t("employees.export.exporting", { defaultValue: "Đang xuất…" })
          : t("employees.exportList")}
      </Button>
      {error && (
        <span
          role="alert"
          className="text-xs text-destructive"
          data-testid="export-employees-error"
        >
          {error}
        </span>
      )}
    </div>
  );
}
