import { Suspense, lazy, useMemo, useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DagValidationResultDto } from "@/lib/workflow-builder/contract";
import { workflowTemplatesApi } from "@/lib/workflow-templates-api";
import { ApiError } from "@/lib/api-client";
import { PermissionGate } from "@/components/permission-gate";
import { Button } from "@/components/ui/button";
import { TemplateStatusBadge } from "@/components/workflows/template-status-badge";
import { StepEditor } from "@/components/workflows/step-editor";
import { DependencyEditor } from "@/components/workflows/dependency-editor";
import { DagErrorList } from "@/components/workflows/dag-error-list";
import { appliesToLabel } from "@/components/workflows/constants";

// Canvas React Flow tải lười (chunk riêng + CSS) — chỉ nạp khi mở tab Sơ đồ.
const TemplateCanvas = lazy(() => import("@/components/workflows/canvas/template-canvas"));

type DetailView = "canvas" | "list";

export function WorkflowTemplateDetailPage() {
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
        setPublishError("Quy trình chưa hợp lệ để xuất bản — xem chi tiết lỗi bên dưới.");
        validate.mutate();
        return;
      }
      setPublishError(err instanceof Error ? err.message : "Xuất bản thất bại.");
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

  if (isLoading) return <div className="p-8 text-sm text-muted-foreground">Đang tải…</div>;
  if (isError || !data)
    return <div className="p-8 text-sm text-destructive">Không tải được quy trình.</div>;

  const { template, steps, dependencies } = data;
  const isDraft = template.status === "draft";

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-8">
      <Link to="/workflows/templates" className="text-sm text-primary hover:underline">
        <span aria-hidden="true">← </span>Danh sách quy trình
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold">{template.name}</h1>
            <TemplateStatusBadge status={template.status} version={template.version} />
          </div>
          <p className="text-sm text-muted-foreground">
            Mã: {template.code} · Áp cho: {appliesToLabel(template.appliesTo)}
          </p>
        </div>

        <div className="flex shrink-0 gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => validate.mutate()}
            disabled={validate.isPending}
          >
            {validate.isPending ? "Đang kiểm tra…" : "Kiểm tra DAG"}
          </Button>
          {isDraft && (
            <PermissionGate action="publish" resourceType="workflow-template">
              <Button size="sm" onClick={() => publish.mutate()} disabled={publish.isPending}>
                {publish.isPending ? "Đang xuất bản…" : "Xuất bản"}
              </Button>
            </PermissionGate>
          )}
          <PermissionGate action="create" resourceType="workflow-template">
            <Button size="sm" variant="outline" onClick={() => clone.mutate()} disabled={clone.isPending}>
              {clone.isPending ? "Đang nhân bản…" : "Nhân bản"}
            </Button>
          </PermissionGate>
        </div>
      </div>

      {!isDraft && (
        <div
          role="note"
          aria-label="Chỉnh sửa bị khoá — quy trình đã xuất bản"
          className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
        >
          Quy trình đã xuất bản là bất biến. Để chỉnh sửa, hãy <strong>Nhân bản</strong> sang một
          bản nháp phiên bản mới.
        </div>
      )}

      {publishError && <p className="text-sm text-destructive">{publishError}</p>}
      <DagErrorList result={validation} />

      {/* View toggle: Sơ đồ (canvas) ↔ Danh sách (fallback bàn phím, a11y 2d) */}
      <div
        role="group"
        aria-label="Chế độ chỉnh sửa phụ thuộc"
        className="inline-flex rounded-lg border border-border bg-muted/30 p-0.5 text-sm"
      >
        <button
          type="button"
          aria-pressed={view === "canvas"}
          onClick={() => setView("canvas")}
          className={`rounded-md px-3 py-1.5 ${view === "canvas" ? "bg-background font-medium shadow-sm" : "text-muted-foreground"}`}
        >
          Sơ đồ
        </button>
        <button
          type="button"
          aria-pressed={view === "list"}
          onClick={() => setView("list")}
          className={`rounded-md px-3 py-1.5 ${view === "list" ? "bg-background font-medium shadow-sm" : "text-muted-foreground"}`}
        >
          Danh sách
        </button>
      </div>

      {view === "canvas" ? (
        <Suspense
          fallback={
            <div className="flex h-[460px] items-center justify-center rounded-xl border border-border text-sm text-muted-foreground">
              Đang tải sơ đồ…
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
            Kéo từ chấm dưới của một bước sang chấm trên của bước khác để tạo phụ thuộc. Chọn cạnh rồi
            nhấn Delete để xoá. Cần thao tác bằng bàn phím? Chuyển sang <strong>Danh sách</strong>.
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
