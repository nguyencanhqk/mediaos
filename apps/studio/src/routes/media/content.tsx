import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import type { ContentItemDto } from "@mediaos/contracts";
import { contentApi, type ContentFilters } from "@/lib/content-api";
import { projectsApi } from "@/lib/projects-api";
import { PermissionGate } from "@mediaos/web-core";
import { useCan } from "@mediaos/web-core";
import { Button } from "@mediaos/ui";
import { Input } from "@mediaos/ui";
import { Select } from "@mediaos/ui";
import { CreateContentDialog } from "@/components/content/create-content-dialog";
import {
  CONTENT_PRIORITY_LABELS,
  CONTENT_STATUS_LABELS,
  CONTENT_STATUS_OPTIONS,
  PRODUCTION_STATUS_LABELS,
  PRODUCTION_STATUS_OPTIONS,
} from "@/components/content/constants";

export function ContentPage() {
  const { t } = useTranslation("channels");
  const qc = useQueryClient();
  const [filters, setFilters] = useState<ContentFilters>({});
  const canDelete = useCan("delete", "content");

  const {
    data: content = [],
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["content", filters],
    queryFn: () => contentApi.listContent(filters),
  });

  const { data: projects = [] } = useQuery({
    queryKey: ["projects", {}],
    queryFn: () => projectsApi.listProjects(),
  });
  const projectName = useMemo(() => {
    const map = new Map(projects.map((p) => [p.id, p.name]));
    return (id: string) => map.get(id) ?? "—";
  }, [projects]);

  const remove = useMutation({
    mutationFn: (id: string) => contentApi.deleteContent(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["content"] }),
  });

  const onDelete = (item: ContentItemDto) => {
    if (window.confirm(t("contentPage.deleteConfirm", { title: item.title }))) remove.mutate(item.id);
  };

  const patch = (p: Partial<ContentFilters>) => setFilters((f) => ({ ...f, ...p }));

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t("contentPage.heading")}</h1>
        <PermissionGate action="create" resourceType="content">
          <CreateContentDialog />
        </PermissionGate>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">{t("contentPage.filterProductionStatusLabel")}</span>
          <Select
            value={filters.productionStatus ?? ""}
            onChange={(e) => patch({ productionStatus: e.target.value || undefined })}
            className="w-44"
          >
            <option value="">{t("contentPage.filterAll")}</option>
            {PRODUCTION_STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {PRODUCTION_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        </label>
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">{t("contentPage.filterStatusLabel")}</span>
          <Select
            value={filters.status ?? ""}
            onChange={(e) => patch({ status: e.target.value || undefined })}
            className="w-40"
          >
            <option value="">{t("contentPage.filterAll")}</option>
            {CONTENT_STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {CONTENT_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex-1 space-y-1">
          <span className="text-xs text-muted-foreground">{t("contentPage.filterSearchLabel")}</span>
          <Input
            value={filters.q ?? ""}
            onChange={(e) => patch({ q: e.target.value || undefined })}
            placeholder={t("contentPage.filterSearchPlaceholder")}
          />
        </label>
        <Button variant="ghost" size="sm" onClick={() => setFilters({})}>
          {t("contentPage.clearFilter")}
        </Button>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">{t("common:loading")}</p>}
      {isError && <p className="text-sm text-destructive">{t("common:errors.loadFailed")}</p>}
      {!isLoading && !isError && content.length === 0 && (
        <p className="text-sm text-muted-foreground">{t("contentPage.noMatch")}</p>
      )}

      {content.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">{t("contentPage.colTitle")}</th>
                <th className="px-4 py-2 font-medium">{t("contentPage.colProject")}</th>
                <th className="px-4 py-2 font-medium">{t("contentPage.colProduction")}</th>
                <th className="px-4 py-2 font-medium">{t("contentPage.colStatus")}</th>
                <th className="px-4 py-2 font-medium">{t("contentPage.colPriority")}</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {content.map((item) => (
                <tr key={item.id} className="hover:bg-muted/30">
                  <td className="px-4 py-2 font-medium">
                    <Link
                      to="/content/$contentId"
                      params={{ contentId: item.id }}
                      className="text-primary hover:underline"
                    >
                      {item.title}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{projectName(item.projectId)}</td>
                  <td className="px-4 py-2">
                    {item.productionStatus ? PRODUCTION_STATUS_LABELS[item.productionStatus] : "—"}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {CONTENT_STATUS_LABELS[item.status]}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {item.priority ? CONTENT_PRIORITY_LABELS[item.priority] : "—"}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {canDelete && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onDelete(item)}
                        disabled={remove.isPending && remove.variables === item.id}
                      >
                        {t("contentPage.deleteButton")}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
