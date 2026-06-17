import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ProjectDto } from "@mediaos/contracts";
import { useTranslation } from "react-i18next";
import { projectsApi, type ProjectFilters } from "@/lib/projects-api";
import { PermissionGate } from "@mediaos/web-core";
import { useCan } from "@mediaos/web-core";
import { useEmployeeOptions } from "@/components/channels/use-channel-options";
import { ProjectFilterBar } from "@/components/projects/project-filter-bar";
import { ProjectTable } from "@/components/projects/project-table";
import { CreateProjectDialog } from "@/components/projects/create-project-dialog";

export function ProjectsPage() {
  const { t } = useTranslation("projects");
  const qc = useQueryClient();
  const [filters, setFilters] = useState<ProjectFilters>({});
  const canDelete = useCan("delete", "project");
  const employees = useEmployeeOptions();

  const {
    data: projects = [],
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["projects", filters],
    queryFn: () => projectsApi.listProjects(filters),
  });

  const remove = useMutation({
    mutationFn: (id: string) => projectsApi.deleteProject(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["projects"] }),
  });

  const onDelete = (project: ProjectDto) => {
    if (window.confirm(t("list.confirmDelete", { name: project.name }))) remove.mutate(project.id);
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t("list.title")}</h1>
        <PermissionGate action="create" resourceType="project">
          <CreateProjectDialog />
        </PermissionGate>
      </div>

      <ProjectFilterBar
        filters={filters}
        onChange={(patch) => setFilters((f) => ({ ...f, ...patch }))}
        onClear={() => setFilters({})}
        employees={employees}
      />

      {isLoading && <p className="text-sm text-muted-foreground">{t("common:loading")}</p>}
      {isError && <p className="text-sm text-destructive">{t("common:errors.loadFailed")}</p>}
      {!isLoading && !isError && projects.length === 0 && (
        <p className="text-sm text-muted-foreground">{t("list.emptyFiltered")}</p>
      )}
      {projects.length > 0 && (
        <ProjectTable
          projects={projects}
          employees={employees}
          canDelete={canDelete}
          onDelete={onDelete}
          deletingId={remove.isPending ? remove.variables : null}
        />
      )}
    </div>
  );
}
