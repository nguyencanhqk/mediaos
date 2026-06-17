import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, Workflow } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TemplateDto, TemplateStatus } from "@/lib/workflow-builder/contract";
import { workflowTemplatesApi } from "@/lib/workflow-templates-api";
import { PermissionGate } from "@mediaos/web-core";
import { useCan } from "@mediaos/web-core";
import { PageHeader } from "@mediaos/ui";
import { EmptyState } from "@mediaos/ui";
import { Skeleton } from "@mediaos/ui";
import { Input } from "@mediaos/ui";
import { Select } from "@mediaos/ui";
import { TemplateTable } from "@/components/workflows/template-table";
import { CreateTemplateDialog } from "@/components/workflows/create-template-dialog";
import { TEMPLATE_STATUS_LABELS, TEMPLATE_STATUS_OPTIONS } from "@/components/workflows/constants";

type StatusFilter = TemplateStatus | "all";

export function WorkflowTemplatesPage() {
  const { t } = useTranslation("workflows");
  const qc = useQueryClient();
  const [query, setQuery] = useState("");
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

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    return templates.filter((tpl) => {
      if (statusFilter !== "all" && tpl.status !== statusFilter) return false;
      if (!term) return true;
      return (
        tpl.name.toLowerCase().includes(term) || (tpl.code ?? "").toLowerCase().includes(term)
      );
    });
  }, [templates, statusFilter, query]);

  const onDelete = (template: TemplateDto) => {
    if (window.confirm(t("templates.confirmDelete", { name: template.name }))) remove.mutate(template.id);
  };

  const hasFilter = query.trim().length > 0 || statusFilter !== "all";

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6 sm:p-8">
      <PageHeader
        title={t("templates.pageTitle")}
        description={t("templates.summary", { count: templates.length })}
        icon={Workflow}
        actions={
          <PermissionGate action="create" resourceType="workflow_template">
            <CreateTemplateDialog />
          </PermissionGate>
        }
      >
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative max-w-sm flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("templates.searchPlaceholder")}
              className="pl-9"
              aria-label={t("templates.searchPlaceholder")}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">{t("templates.statusFilter")}</span>
            <Select
              className="h-10 w-44"
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
      </PageHeader>

      {isLoading ? (
        <div className="space-y-2 rounded-xl border border-border bg-card p-4 shadow-sm">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={`tpl-skel-${i}`} className="h-10 w-full" />
          ))}
        </div>
      ) : isError ? (
        <EmptyState
          icon={Workflow}
          title={t("templates.loadError")}
          description={t("templates.loadHint")}
        />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={Workflow}
          title={hasFilter ? t("templates.searchEmpty") : t("templates.empty")}
          description={hasFilter ? undefined : t("templates.emptyHint")}
        />
      ) : (
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
