import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { FolderKanban, Plus, Users } from "lucide-react";
import type { ProjectDto } from "@mediaos/contracts";
import { Badge, Button, Card, EmptyState, PageHeader, Skeleton } from "@mediaos/ui";
import { PermissionGate } from "@mediaos/web-core";
import { projectsApi } from "@/lib/projects-api";
import { queryKeys } from "@/lib/query-keys";
import { CreateProjectDialog } from "@/components/create-project-dialog";

const PROJECT_STATUS_VARIANT: Record<ProjectDto["status"], "success" | "warning" | "muted"> = {
  active: "success",
  paused: "warning",
  archived: "muted",
};

/** Trang chủ app Dự án — danh sách dự án dạng card. Click card → board của dự án. */
export function ProjectsListPage() {
  const { t } = useTranslation("projects");
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = useState(false);

  const projects = useQuery({
    queryKey: queryKeys.projects,
    queryFn: () => projectsApi.listProjects(),
  });

  const openProject = (id: string) =>
    void navigate({ to: "/projects/$projectId", params: { projectId: id } });

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <PageHeader
        icon={FolderKanban}
        title={t("list.pageTitle")}
        description={t("list.pageDescription")}
        actions={
          <PermissionGate action="create" resourceType="project">
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" />
              {t("list.createButton")}
            </Button>
          </PermissionGate>
        }
      />

      {projects.isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full rounded-xl" />
          ))}
        </div>
      ) : projects.isError ? (
        <Card className="p-6">
          <p className="text-sm text-destructive">{t("list.loadError")}</p>
        </Card>
      ) : projects.data && projects.data.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.data.map((project) => (
            <button
              key={project.id}
              type="button"
              onClick={() => openProject(project.id)}
              className="group flex flex-col gap-3 rounded-xl border border-border bg-card p-5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-violet-500/12 text-violet-600">
                  <FolderKanban className="h-5 w-5" strokeWidth={1.9} />
                </span>
                <Badge variant={PROJECT_STATUS_VARIANT[project.status]}>
                  {t(`status.${project.status}`)}
                </Badge>
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  {project.identifier && (
                    <Badge variant="brand" className="font-mono">
                      {project.identifier}
                    </Badge>
                  )}
                  <h2 className="truncate text-base font-semibold text-foreground">
                    {project.name}
                  </h2>
                </div>
                {project.description && (
                  <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                    {project.description}
                  </p>
                )}
              </div>
              {project.members && (
                <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Users className="h-3.5 w-3.5" />
                  {t("list.memberCount", { count: project.members.length })}
                </span>
              )}
            </button>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={FolderKanban}
          title={t("list.emptyTitle")}
          description={t("list.emptyDescription")}
          action={
            <PermissionGate action="create" resourceType="project">
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4" />
                {t("list.createButton")}
              </Button>
            </PermissionGate>
          }
        />
      )}

      <CreateProjectDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(project) => openProject(project.id)}
      />
    </div>
  );
}
