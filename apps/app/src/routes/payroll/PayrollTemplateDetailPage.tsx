import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { payrollApi, payrollKeys, useCanExact } from "@mediaos/web-core";
import type { PayrollTemplateDetailDto } from "@mediaos/contracts";
import { Button, DetailPageHeader, EmptyState, StatusPill } from "@mediaos/ui";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { PAYROLL_ENGINE_PAIRS } from "./constants";
import { parsePayrollError, payrollErrorText } from "./payroll-errors";
import { isTemplateDirty, rowsFromDetail, toPutPayload, type TemplateRow } from "./template-editor";
import { useSalaryComponentsFullCatalog } from "./use-salary-components-catalog";
import { TemplateComponentsEditor } from "./components/TemplateComponentsEditor";
import { TemplateFormDialog } from "./components/TemplateFormDialog";
import { TemplatePreviewDialog } from "./components/TemplatePreviewDialog";

/**
 * PAY-SCREEN-010 chi tiết `/payroll/templates/:id` — thành phần · nhãn cột · công thức ghi đè · ẩn/hiện ·
 * thứ tự (051/053) + xem trước (054) + sửa/ngưng/xoá (052).
 *
 * - Sửa CỤC BỘ, «Lưu» gửi MỘT lượt 053 (D6); rời trang khi còn thay đổi thì mất — nút «Hoàn tác» đưa về bản
 *   server. Sau khi lưu, bảng đồng bộ lại từ 051 (server là nguồn thứ tự/nhãn cuối cùng).
 * - 🔴 **Bản 051 mới về KHÔNG được đè thay đổi chưa lưu** (TS review FE-2, HIGH): «Ngưng dùng»/«Sửa thông
 *   tin» invalidate cả nhánh catalog ⇒ 051 về object MỚI; đồng bộ mù theo `detail` là xoá sạch bảng đang sửa,
 *   không cảnh báo. Chỉ đồng bộ khi: lần đầu · đổi sang mẫu khác · bảng chưa sửa · ngay sau «Lưu» thành công.
 *   Ba mục ⋯ (sửa thông tin · ngưng · xoá) còn KHOÁ khi đang có thay đổi chưa lưu.
 * - «Xem trước» chạy trên mẫu ĐÃ LƯU (D8) ⇒ khoá khi còn thay đổi chưa lưu.
 * - Chỉ có `view:payroll-template` ⇒ bảng chỉ đọc, không nút ghi nào.
 */
export function PayrollTemplateDetailPage({
  templateId,
  onBack,
}: {
  templateId: string;
  onBack: () => void;
}) {
  const { t } = useTranslation("payroll");
  const queryClient = useQueryClient();

  const canView = useCanExact(
    PAYROLL_ENGINE_PAIRS.templateDetail.action,
    PAYROLL_ENGINE_PAIRS.templateDetail.resourceType,
  );
  const canManage = useCanExact(
    PAYROLL_ENGINE_PAIRS.templatePutComponents.action,
    PAYROLL_ENGINE_PAIRS.templatePutComponents.resourceType,
  );
  const canValidate = useCanExact(
    PAYROLL_ENGINE_PAIRS.componentValidateFormula.action,
    PAYROLL_ENGINE_PAIRS.componentValidateFormula.resourceType,
  );

  const detailQuery = useQuery({
    queryKey: payrollKeys.catalog.templateDetail(templateId),
    queryFn: () => payrollApi.getPayrollTemplate(templateId),
    enabled: canView,
  });
  const detail = detailQuery.data;
  const catalog = useSalaryComponentsFullCatalog(canView && canManage);

  const [rows, setRows] = useState<TemplateRow[]>([]);
  // `baseline` = bản 051 mà `rows` đang được soạn từ đó — mốc so «đã sửa chưa».
  const [baseline, setBaseline] = useState<PayrollTemplateDetailDto | undefined>(undefined);
  const [resyncAfterSave, setResyncAfterSave] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const dirty = isTemplateDirty(rows, baseline);
  // Điều chỉnh state theo dữ liệu mới NGAY TRONG render (mẫu «adjusting state on prop change» của React) —
  // có điều kiện dừng: sau khi đặt `baseline = detail` thì nhánh này không chạy nữa.
  if (detail && detail !== baseline) {
    const mayResync = !baseline || baseline.id !== detail.id || !dirty || resyncAfterSave;
    if (mayResync) {
      setBaseline(detail);
      setRows(rowsFromDetail(detail));
      setResyncAfterSave(false);
    }
  }

  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: payrollKeys.catalog.allOf() });

  const saveMutation = useMutation({
    mutationFn: () => payrollApi.putPayrollTemplateComponents(templateId, toPutPayload(rows)),
    onMutate: () => setFeedback(null),
    onSuccess: () => {
      setResyncAfterSave(true);
      invalidate();
      setFeedback({ tone: "ok", text: t("templateDetail.saved") });
    },
    onError: (e) => setFeedback({ tone: "error", text: payrollErrorText(t, parsePayrollError(e)) }),
  });

  const metaMutation = useMutation({
    mutationFn: (body: { isActive: boolean } | { delete: true }) =>
      payrollApi.updatePayrollTemplate(templateId, body),
    onMutate: () => setFeedback(null),
    onSuccess: (_res, body) => {
      invalidate();
      setDeleteOpen(false);
      if ("delete" in body) onBack();
    },
    onError: (e) => {
      setDeleteOpen(false);
      setFeedback({ tone: "error", text: payrollErrorText(t, parsePayrollError(e)) });
    },
  });

  if (!canView) return <EmptyState title={t("templates.noPermission")} />;
  if (detailQuery.isLoading) {
    return <div className="p-6 text-sm text-muted-foreground">{t("states.loading")}</div>;
  }
  if (detailQuery.isError || !detail) {
    return (
      <EmptyState
        title={t("states.error")}
        action={
          <Button variant="outline" onClick={() => void detailQuery.refetch()}>
            {t("states.retry")}
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-6">
      <DetailPageHeader
        onBack={onBack}
        title={detail.name}
        status={
          <StatusPill
            tone={detail.isActive ? "success" : "muted"}
            label={t(detail.isActive ? "components.active" : "components.inactive")}
          />
        }
        subtitle={
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-mono">{detail.code}</span>
            <span>{t(`templateScope.${detail.scope}`)}</span>
            <span title={detail.formulaSetFingerprint}>
              {t("templateDetail.fingerprint", { fp: detail.formulaSetFingerprint.slice(0, 12) })}
            </span>
          </div>
        }
        actions={
          canManage ? (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPreviewOpen(true)}
                disabled={dirty}
                title={dirty ? t("templateDetail.saveBeforePreview") : undefined}
              >
                {t("templateDetail.preview")}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setRows(rowsFromDetail(baseline ?? detail))}
                disabled={!dirty || saveMutation.isPending}
              >
                {t("templateDetail.reset")}
              </Button>
              <Button
                size="sm"
                onClick={() => saveMutation.mutate()}
                disabled={!dirty || saveMutation.isPending}
              >
                {t("templateDetail.save")}
              </Button>
            </div>
          ) : undefined
        }
        overflowItems={
          canManage
            ? [
                {
                  key: "edit",
                  label: t("templateDetail.editInfo"),
                  onSelect: () => setEditOpen(true),
                  disabled: dirty,
                },
                {
                  key: "toggle",
                  label: t(detail.isActive ? "components.deactivate" : "components.activate"),
                  onSelect: () => metaMutation.mutate({ isActive: !detail.isActive }),
                  disabled: dirty || metaMutation.isPending,
                },
                {
                  key: "delete",
                  label: t("templateDetail.delete"),
                  onSelect: () => setDeleteOpen(true),
                  disabled: dirty,
                },
              ]
            : []
        }
      />

      {dirty && (
        <div className="rounded-md border border-warning/40 bg-warning-muted/40 px-4 py-3 text-sm">
          {t("templateDetail.unsaved")}
        </div>
      )}
      {feedback && (
        <div
          role={feedback.tone === "error" ? "alert" : "status"}
          className={`rounded-md border px-4 py-3 text-sm ${
            feedback.tone === "ok"
              ? "border-success/40 bg-success-muted/40"
              : "border-danger/40 bg-danger-muted/40"
          }`}
        >
          {feedback.text}
        </div>
      )}
      {canManage && catalog.isTruncated && (
        <p className="text-xs text-warning">{t("templateDetail.catalogTruncated")}</p>
      )}

      <TemplateComponentsEditor
        rows={rows}
        onChange={setRows}
        editable={canManage}
        catalog={catalog.components}
        knownCodes={catalog.codes}
        canValidate={canValidate}
      />

      {canManage && (
        <>
          <TemplateFormDialog
            open={editOpen}
            onClose={() => setEditOpen(false)}
            template={detail}
          />
          <TemplatePreviewDialog
            open={previewOpen}
            onClose={() => setPreviewOpen(false)}
            templateId={templateId}
            rows={rows}
          />
          <ConfirmDialog
            open={deleteOpen}
            title={t("templateDetail.deleteTitle", { name: detail.name })}
            description={t("templateDetail.deleteDescription")}
            confirmLabel={t("templateDetail.delete")}
            cancelLabel={t("actions.cancel")}
            destructive
            busy={metaMutation.isPending}
            onConfirm={() => metaMutation.mutate({ delete: true })}
            onCancel={() => setDeleteOpen(false)}
          />
        </>
      )}
    </div>
  );
}
