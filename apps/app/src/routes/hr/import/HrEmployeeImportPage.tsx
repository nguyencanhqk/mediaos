/**
 * HrEmployeeImportPage — S5-HR-IMPORT-FE-1 (SPEC-03 §7 "Import hàng loạt", HR.EMPLOYEE.IMPORT).
 *
 * Stepper 3 bước: (1) tải template + chọn file → (2) dryRun (preview, KHÔNG ghi) → (3) áp dụng thật
 * (dryRun=false, partial-success) → màn kết quả. Gate `useCanExact('import','employee')` — cặp NHẠY CẢM
 * (mig 0496): route + entry point (nút trên EmployeeListPage) chỉ hiện khi có allowlisted cap thật, KHÔNG
 * suy từ wildcard '*:*' (mirror ExportEmployeesButton/EmployeeFilesTab). Server vẫn là cổng thật
 * (PermissionGuard + assertImportScope Company/System) nếu bị gọi trực tiếp.
 *
 * Masking là việc của SERVER — component chỉ render field HrImportReport/HrImportResult trả về.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Upload } from "lucide-react";
import { hrApi, hrInvalidation, useCanExact, mapApiErrorToUi } from "@mediaos/web-core";
import { EmptyState, PageHeader } from "@mediaos/ui";
import type { HrImportReport, HrImportResult } from "@mediaos/contracts";
import { HR_IMPORT_EMPLOYEE_PAIR } from "./constants";
import { ImportUploadStep } from "./ImportUploadStep";
import { ImportPreviewStep } from "./ImportPreviewStep";
import { ImportResultStep } from "./ImportResultStep";

type ImportStepState =
  | { kind: "upload" }
  | { kind: "preview"; file: File; report: HrImportReport }
  | { kind: "result"; result: HrImportResult };

export function HrEmployeeImportPage() {
  const { t } = useTranslation("hr");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canImport = useCanExact(
    HR_IMPORT_EMPLOYEE_PAIR.action,
    HR_IMPORT_EMPLOYEE_PAIR.resourceType,
  );

  const [step, setStep] = useState<ImportStepState>({ kind: "upload" });

  const previewMutation = useMutation({
    mutationFn: (file: File) => hrApi.previewEmployeeImport(file),
  });
  const applyMutation = useMutation({
    mutationFn: (file: File) => hrApi.applyEmployeeImport(file),
  });

  // ── Forbidden (cặp nhạy cảm — belt-and-suspenders cùng route-level RouteMeta gate) ────────────────
  if (!canImport) {
    return (
      <div className="p-6">
        <EmptyState
          icon={Upload}
          title={t("import.forbidden.title")}
          description={t("import.forbidden.description")}
        />
      </div>
    );
  }

  const goToList = () => void navigate({ to: "/hr/employees" as "/" });

  const handlePreview = async (file: File): Promise<void> => {
    previewMutation.reset();
    try {
      const report = await previewMutation.mutateAsync(file);
      setStep({ kind: "preview", file, report });
    } catch {
      // Lỗi hiển thị qua previewMutation.error (ImportUploadStep) — KHÔNG đổi bước.
    }
  };

  const handleApply = async (): Promise<void> => {
    if (step.kind !== "preview") return;
    applyMutation.reset();
    try {
      const result = await applyMutation.mutateAsync(step.file);
      // Đã tạo hồ sơ hàng loạt — làm mới danh sách/tổng quan nhân sự (mọi biến thể query đã cache).
      await Promise.all(
        hrInvalidation.applyImport().map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      );
      setStep({ kind: "result", result });
    } catch {
      // Lỗi hiển thị qua applyMutation.error (ImportPreviewStep) — giữ nguyên bước preview.
    }
  };

  const handleReset = (): void => {
    previewMutation.reset();
    applyMutation.reset();
    setStep({ kind: "upload" });
  };

  return (
    <div className="space-y-4 p-6">
      <PageHeader title={t("import.title")} description={t("import.description")} icon={Upload} />

      {step.kind === "upload" && (
        <ImportUploadStep
          onPreview={(file) => void handlePreview(file)}
          isSubmitting={previewMutation.isPending}
          error={previewMutation.isError ? mapApiErrorToUi(previewMutation.error).message : null}
        />
      )}

      {step.kind === "preview" && (
        <ImportPreviewStep
          report={step.report}
          onBack={handleReset}
          onApply={() => void handleApply()}
          isApplying={applyMutation.isPending}
          error={applyMutation.isError ? mapApiErrorToUi(applyMutation.error).message : null}
        />
      )}

      {step.kind === "result" && (
        <ImportResultStep
          result={step.result}
          onImportAnother={handleReset}
          onBackToList={goToList}
        />
      )}
    </div>
  );
}
