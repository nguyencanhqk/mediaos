/**
 * ImportUploadStep — Bước 1/3 của màn import nhân viên (S5-HR-IMPORT-FE-1).
 *
 * Tải template mẫu (GET /hr/employees/import/template, nhị phân) + chọn file (input ẩn, validate CLIENT
 * đuôi/dung lượng TRƯỚC khi cho phép "Xem trước" — server vẫn re-check thật, đây chỉ là UX báo lỗi sớm).
 */
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Download, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { hrApi, mapApiErrorToUi } from "@mediaos/web-core";
import { Button } from "@mediaos/ui";
import {
  HR_IMPORT_ACCEPT_ATTR,
  HR_IMPORT_MAX_FILE_BYTES,
  formatImportFileSize,
  hasAcceptedImportExtension,
} from "./constants";

const DEFAULT_TEMPLATE_FILENAME = "employee-import-template.csv";

/** Tải file nhị phân qua thẻ <a download> ẩn — mirror routes/hr/employees/download-blob.ts (bản sao cục
 * bộ theo feature, tránh coupling chéo employees↔import). No-op an toàn khi thiếu DOM (SSR/test). */
function triggerDownload(blob: Blob, filename: string): void {
  if (
    typeof document === "undefined" ||
    typeof URL === "undefined" ||
    typeof URL.createObjectURL !== "function"
  ) {
    return;
  }
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

export interface ImportUploadStepProps {
  onPreview: (file: File) => void;
  isSubmitting: boolean;
  error: string | null;
}

export function ImportUploadStep({ onPreview, isSubmitting, error }: ImportUploadStepProps) {
  const { t } = useTranslation("hr");
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  async function handleDownloadTemplate(): Promise<void> {
    setIsDownloading(true);
    setDownloadError(null);
    try {
      const { blob, filename } = await hrApi.downloadImportTemplate();
      triggerDownload(blob, filename ?? DEFAULT_TEMPLATE_FILENAME);
    } catch (e) {
      setDownloadError(mapApiErrorToUi(e).message || t("import.upload.downloadTemplateError"));
    } finally {
      setIsDownloading(false);
    }
  }

  function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>): void {
    const selected = e.target.files?.[0];
    if (!selected) return;
    if (!hasAcceptedImportExtension(selected.name)) {
      setFile(null);
      setClientError(t("import.upload.invalidType"));
      return;
    }
    if (selected.size > HR_IMPORT_MAX_FILE_BYTES) {
      setFile(null);
      setClientError(t("import.upload.tooLarge"));
      return;
    }
    setClientError(null);
    setFile(selected);
  }

  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-6 shadow-sm">
      <p className="text-sm font-medium text-foreground">{t("import.upload.stepLabel")}</p>

      <div className="flex flex-col items-start gap-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void handleDownloadTemplate()}
          disabled={isDownloading}
        >
          {isDownloading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Download className="mr-2 h-4 w-4" aria-hidden />
          )}
          {t("import.upload.downloadTemplate")}
        </Button>
        {downloadError && (
          <span role="alert" className="text-xs text-destructive">
            {downloadError}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-border p-4">
        <FileSpreadsheet className="h-8 w-8 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="truncate text-sm text-foreground">
            {file
              ? t("import.upload.selectedFile", {
                  name: file.name,
                  size: formatImportFileSize(file.size),
                })
              : t("import.upload.noFileChosen")}
          </p>
          <p className="text-xs text-muted-foreground">{t("import.upload.hint")}</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
          {file ? t("import.upload.changeFile") : t("import.upload.chooseFile")}
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept={HR_IMPORT_ACCEPT_ATTR}
          className="hidden"
          onChange={handleFileSelected}
          data-testid="hr-import-file-input"
        />
      </div>

      {clientError && (
        <p role="alert" className="text-sm text-destructive">
          {clientError}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <Button
        type="button"
        onClick={() => file && onPreview(file)}
        disabled={!file || isSubmitting}
        data-testid="hr-import-preview-button"
      >
        {isSubmitting ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <Upload className="mr-2 h-4 w-4" aria-hidden />
        )}
        {isSubmitting ? t("import.upload.previewing") : t("import.upload.previewButton")}
      </Button>
    </div>
  );
}
