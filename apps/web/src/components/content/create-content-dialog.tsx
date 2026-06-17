import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { CreateContentItemRequest } from "@mediaos/contracts";
import { Button } from "@mediaos/ui";
import { Dialog } from "@mediaos/ui";
import { Input } from "@mediaos/ui";
import { Select } from "@mediaos/ui";
import { contentApi } from "@/lib/content-api";
import { projectsApi } from "@/lib/projects-api";

interface CreateContentDialogProps {
  /** Khi mở từ trang project: cố định project (ẩn dropdown). */
  fixedProjectId?: string;
}

export function CreateContentDialog({ fixedProjectId }: CreateContentDialogProps) {
  const { t } = useTranslation("channels");
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState(fixedProjectId ?? "");
  const [contentTypeId, setContentTypeId] = useState("");

  const { data: projects = [] } = useQuery({
    queryKey: ["projects", {}],
    queryFn: () => projectsApi.listProjects(),
    enabled: open && !fixedProjectId,
  });
  const { data: types = [] } = useQuery({
    queryKey: ["content-types"],
    queryFn: () => contentApi.listContentTypes(),
    enabled: open,
  });

  /** Gợi ý workflow theo content type (CNT-001) — đọc default_workflow_template_id của type. */
  const suggestedWorkflow = useMemo(
    () => types.find((t) => t.id === contentTypeId)?.defaultWorkflowTemplateId ?? null,
    [types, contentTypeId],
  );

  const create = useMutation({
    mutationFn: () => {
      const req: CreateContentItemRequest = { projectId, title: title.trim() };
      if (contentTypeId) req.contentTypeId = contentTypeId;
      return contentApi.createContent(req);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["content"] });
      setTitle("");
      setContentTypeId("");
      if (!fixedProjectId) setProjectId("");
      setOpen(false);
    },
  });

  const canSubmit = Boolean(title.trim() && projectId);

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        {t("createContentDialog.openButton")}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t("createContentDialog.title")}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              {t("createContentDialog.cancel")}
            </Button>
            <Button size="sm" onClick={() => create.mutate()} disabled={!canSubmit || create.isPending}>
              {create.isPending ? t("createContentDialog.creating") : t("createContentDialog.createButton")}
            </Button>
          </>
        }
      >
        <label className="block space-y-1">
          <span className="text-sm font-medium">{t("createContentDialog.titleLabel")}</span>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("createContentDialog.titlePlaceholder")} />
        </label>

        {!fixedProjectId && (
          <label className="block space-y-1">
            <span className="text-sm font-medium">{t("createContentDialog.projectLabel")}</span>
            <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">{t("createContentDialog.projectPlaceholder")}</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </label>
        )}

        <label className="block space-y-1">
          <span className="text-sm font-medium">{t("createContentDialog.contentTypeLabel")}</span>
          <Select value={contentTypeId} onChange={(e) => setContentTypeId(e.target.value)}>
            <option value="">{t("createContentDialog.contentTypePlaceholder")}</option>
            {types.map((typ) => (
              <option key={typ.id} value={typ.id}>
                {typ.name}
              </option>
            ))}
          </Select>
        </label>

        {contentTypeId && (
          <p className="text-xs text-muted-foreground">
            {suggestedWorkflow
              ? t("createContentDialog.workflowSuggested", { workflowId: suggestedWorkflow })
              : t("createContentDialog.noDefaultWorkflow")}
          </p>
        )}

        {create.isError && (
          <p className="text-sm text-destructive">
            {t("createContentDialog.createFailed")}{" "}
            {create.error instanceof Error ? create.error.message : t("createContentDialog.errorUnknown")}
          </p>
        )}
      </Dialog>
    </>
  );
}
