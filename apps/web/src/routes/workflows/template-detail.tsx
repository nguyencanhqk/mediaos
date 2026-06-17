import { Suspense, lazy, useMemo, useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trans, useTranslation } from "react-i18next";
import type { DagValidationResultDto } from "@/lib/workflow-builder/contract";
import { workflowTemplatesApi } from "@/lib/workflow-templates-api";
import { ApiError } from "@/lib/api-client";
import { ArrowLeft } from "lucide-react";
import { PermissionGate } from "@/components/permission-gate";
import { Button } from "@/components/ui/button";
import { TemplateStatusBadge } from "@/components/workflows/template-status-badge";
import { StepEditor } from "@/components/workflows/step-editor";
import { DependencyEditor } from "@/components/workflows/dependency-editor";
import { DagErrorList } from "@/components/workflows/dag-error-list";
import { RunWorkflowDialog } from "@/components/workflows/run-workflow-dialog";
import { appliesToLabel } from "@/components/workflows/constants";

// Canvas React Flow tải lười (chunk riêng + CSS) — chỉ nạp khi mở tab Sơ đồ.
const TemplateCanvas = lazy(() => import("@/components/workflows/canvas/template-canvas"));

type DetailView = "canvas" | "list";

export function WorkflowTemplateDetailPage() {
  const { t } = useTranslation("workflows");
  const { templateId } = useParams({ from: "/workflows/templates/$templateId" });
  const qc = useQueryClient();
  const [validation, setValidation] = useState<DagValidationResultDto | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [view, setView] = useState<DetailView>("canvas");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["workflow-template", templateId],
    queryFn: () => workflowTemplatesApi.get(templateId),
  });

  const invalidateAll = () => {
    void qc.invalidateQueries({ queryKey: ["workflow-template", templateId] });
    void qc.invalidateQueries({ queryKey: ["workflow-templates"] });
  };

  const validate = useMutation({
    mutationFn: () => workflowTemplatesApi.validate(templateId),
    onSuccess: (result) => setValidation(result),
  });

  const publish = useMutation({
    mutationFn: () => workflowTemplatesApi.publish(templateId),
    onSuccess: () => {
      setValidation(null);
      setPublishError(null);
      invalidateAll();
    },
    onError: (err) => {
      // BẤT BIẾN BE: AllExceptionsFilter dẹp payload `dagValidation` của 422 → chỉ còn message+status.
      // 422 = DAG không hợp lệ → chạy lại validator client-side để DỰNG danh sách lỗi inline.
      // 409 = đã xuất bản / publish đồng thời → chỉ hiển thị message.
      if (err instanceof ApiError && err.status === 422) {
        setPublishError(t("detail.publishErrorInvalid"));
        validate.mutate();
        return;
      }
      setPublishError(err instanceof Error ? err.message : t("detail.publishErrorFallback"));
    },
  });

  const clone = useMutation({
    mutationFn: () => workflowTemplatesApi.clone(templateId),
    onSuccess: () => invalidateAll(),
  });

  // node_key của các bước lỗi DAG → tô đỏ trên canvas. Gọi trước early-return (rules-of-hooks).
  const errorNodeKeys = useMemo(
    () => new Set((validation?.errors ?? []).flatMap((e) => e.nodeKeys)),
    [validation],
  );

  if (isLoading) return <div className="p-8 text-sm text-muted-foreground">{t("detail.loading")}</div>;
  if (isError || !data)
    return <div className="p-8 text-sm text-destructive">{t("detail.loadError")}</div>;

  const { template, steps, dependencies } = data;
  const isDraft = template.status === "draft";

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-8">
      <Link
        to="/workflows/templates"
        className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {t("detail.backLink")}
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold">{template.name}</h1>
            <TemplateStatusBadge status={template.status} version={template.version} />
          </div>
          <p className="text-sm text-muted-foreground">
            {t("detail.metaLine", { code: template.code, appliesTo: appliesToLabel(template.appliesTo) })}
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          {!isDraft && (
            <PermissionGate action="create" resourceType="workflow_instance">
              <RunWorkflowDialog templateId={templateId} />
            </PermissionGate>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => validate.mutate()}
            disabled={validate.isPending}
          >
            {validate.isPending ? t("detail.validating") : t("detail.validateBtn")}
          </Button>
          {isDraft && (
            <PermissionGate action="publish" resourceType="workflow-template">
              <Button size="sm" onClick={() => publish.mutate()} disabled={publish.isPending}>
                {publish.isPending ? t("detail.publishing") : t("detail.publishBtn")}
              </Button>
            </PermissionGate>
          )}
          <PermissionGate action="create" resourceType="workflow-template">
            <Button size="sm" variant="outline" onClick={() => clone.mutate()} disabled={clone.isPending}>
              {clone.isPending ? t("detail.cloning") : t("detail.cloneBtn")}
            </Button>
          </PermissionGate>
        </div>
      </div>

      {!isDraft && (
        <div
          role="note"
          aria-label={t("detail.immutableBannerAriaLabel")}
          className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
        >
          <Trans t={t} i18nKey="detail.immutableBanner" components={{ strong: <strong /> }} />
        </div>
      )}

      {publishError && <p className="text-sm text-destructive">{publishError}</p>}
      <DagErrorList result={validation} />

      {/* View toggle: Sơ đồ (canvas) ↔ Danh sách (fallback bàn phím, a11y 2d) */}
      <div
        role="group"
        aria-label={t("detail.viewToggleAriaLabel")}
        className="inline-flex rounded-lg border border-border bg-muted/30 p-0.5 text-sm"
      >
        <button
          type="button"
          aria-pressed={view === "canvas"}
          onClick={() => setView("canvas")}
          className={`rounded-md px-3 py-1.5 ${view === "canvas" ? "bg-background font-medium shadow-sm" : "text-muted-foreground"}`}
        >
          {t("detail.viewCanvas")}
        </button>
        <button
          type="button"
          aria-pressed={view === "list"}
          onClick={() => setView("list")}
          className={`rounded-md px-3 py-1.5 ${view === "list" ? "bg-background font-medium shadow-sm" : "text-muted-foreground"}`}
        >
          {t("detail.viewList")}
        </button>
      </div>

      {view === "canvas" ? (
        <Suspense
          fallback={
            <div className="flex h-[460px] items-center justify-center rounded-xl border border-border text-sm text-muted-foreground">
              {t("detail.canvasLoadingFallback")}
            </div>
          }
        >
          <TemplateCanvas
            templateId={templateId}
            steps={steps}
            dependencies={dependencies}
            errorNodeKeys={errorNodeKeys}
            disabled={!isDraft}
            hintId="canvas-usage-hint"
          />
          <p id="canvas-usage-hint" className="text-xs text-muted-foreground">
            <Trans t={t} i18nKey="detail.canvasHint" components={{ strong: <strong /> }} />
          </p>
        </Suspense>
      ) : (
        <DependencyEditor
          templateId={templateId}
          steps={steps}
          dependencies={dependencies}
          disabled={!isDraft}
        />
      )}

      <StepEditor templateId={templateId} steps={steps} disabled={!isDraft} />
    </div>
  );
}
