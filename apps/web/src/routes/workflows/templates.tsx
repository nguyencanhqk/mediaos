import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { TemplateDto, TemplateStatus } from "@/lib/workflow-builder/contract";
import { workflowTemplatesApi } from "@/lib/workflow-templates-api";
import { PermissionGate } from "@/components/permission-gate";
import { useCan } from "@/hooks/use-can";
import { Select } from "@/components/ui/select";
import { TemplateTable } from "@/components/workflows/template-table";
import { CreateTemplateDialog } from "@/components/workflows/create-template-dialog";
import { TEMPLATE_STATUS_LABELS, TEMPLATE_STATUS_OPTIONS } from "@/components/workflows/constants";

type StatusFilter = TemplateStatus | "all";

export function WorkflowTemplatesPage() {
  const { t } = useTranslation("workflows");
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const canDelete = useCan("update", "workflow_template");

  const { data: templates = [], isLoading, isError } = useQuery({
    queryKey: ["workflow-templates"],
    queryFn: () => workflowTemplatesApi.list(),
  });

  const remove = useMutation({
    mutationFn: (id: string) => workflowTemplatesApi.remove(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["workflow-templates"] }),
  });

  const visible = useMemo(
    () => (statusFilter === "all" ? templates : templates.filter((t) => t.status === statusFilter)),
    [templates, statusFilter],
  );

  const onDelete = (template: TemplateDto) => {
    if (window.confirm(t("templates.confirmDelete", { name: template.name }))) remove.mutate(template.id);
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{t("templates.pageTitle")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("templates.pageSubtitle")}
          </p>
        </div>
        <PermissionGate action="create" resourceType="workflow_template">
          <CreateTemplateDialog />
        </PermissionGate>
      </div>

      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">{t("templates.statusFilter")}</span>
          <Select
            className="h-9 w-44"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          >
            <option value="all">{t("templates.statusAll")}</option>
            {TEMPLATE_STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {TEMPLATE_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        </label>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">{t("common:loading")}</p>}
      {isError && <p className="text-sm text-destructive">{t("templates.loadError")}</p>}
      {!isLoading && !isError && visible.length === 0 && (
        <p className="text-sm text-muted-foreground">{t("templates.empty")}</p>
      )}
      {visible.length > 0 && (
        <TemplateTable
          templates={visible}
          canDelete={canDelete}
          onDelete={onDelete}
          deletingId={remove.isPending ? remove.variables : null}
        />
      )}
    </div>
  );
}
