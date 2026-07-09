/**
 * ExportAttendanceButton — nút "Xuất CSV" bảng công (S3-ATT-EXPORT-1, ATT.ATTENDANCE.EXPORT).
 *
 * Gate: <PermissionGate export:attendance> — KHÔNG hard-code role; thiếu quyền → nút KHÔNG render (server
 * vẫn là cổng thật, 403 nếu bị gọi trực tiếp). Tải nhị phân qua attendanceApi.exportCompanyRecords →
 * apiFetchBlob (refresh-on-401 replay). Có loading (disabled + spinner) + error (inline alert người-đọc);
 * server áp data-scope + cap MAX_ROWS (422 vượt cap → hiện lỗi, KHÔNG tải file cắt im lặng).
 *
 * Masking (location/gps/ip/device) là việc của SERVER — CSV chỉ chứa cột an toàn (ATTENDANCE_EXPORT_COLUMNS).
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Download, Loader2 } from "lucide-react";
import { PermissionGate, attendanceApi, mapApiErrorToUi } from "@mediaos/web-core";
import { Button } from "@mediaos/ui";
import { ATT_ENGINE_PAIRS } from "./constants";
import { triggerBlobDownload } from "./download-blob";

/** Query xuất CSV — suy TRỰC TIẾP từ chữ ký attendanceApi.exportCompanyRecords (DRY, không drift contract). */
type ExportQuery = NonNullable<Parameters<typeof attendanceApi.exportCompanyRecords>[0]>;

interface ExportAttendanceButtonProps {
  /** Bộ lọc hiện tại của bảng công (parity fromDate/toDate/departmentId/employeeId/attendanceStatus). */
  query: ExportQuery;
  /** Tên file dự phòng khi server KHÔNG gửi Content-Disposition. */
  fallbackFilename?: string;
}

const DEFAULT_EXPORT_FILENAME = "attendance-records.csv";

export function ExportAttendanceButton({ query, fallbackFilename }: ExportAttendanceButtonProps) {
  const { t } = useTranslation("attendance");
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleExport(): Promise<void> {
    setIsExporting(true);
    setError(null);
    try {
      const { blob, filename } = await attendanceApi.exportCompanyRecords(query);
      triggerBlobDownload(blob, filename ?? fallbackFilename ?? DEFAULT_EXPORT_FILENAME);
    } catch (e) {
      // 403/422(vượt cap)/500 → thông điệp người-đọc; KHÔNG tải file lỗi.
      setError(mapApiErrorToUi(e).message);
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <PermissionGate
      action={ATT_ENGINE_PAIRS.EXPORT.action}
      resourceType={ATT_ENGINE_PAIRS.EXPORT.resourceType}
    >
      <div className="flex flex-col items-end gap-1">
        <Button
          variant="outline"
          size="sm"
          onClick={() => void handleExport()}
          disabled={isExporting}
          data-testid="export-attendance-button"
        >
          {isExporting ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Download className="mr-2 h-4 w-4" aria-hidden />
          )}
          {isExporting
            ? t("export.exporting", { defaultValue: "Đang xuất…" })
            : t("export.button", { defaultValue: "Xuất CSV" })}
        </Button>
        {error && (
          <span role="alert" className="text-xs text-destructive" data-testid="export-error">
            {error}
          </span>
        )}
      </div>
    </PermissionGate>
  );
}
