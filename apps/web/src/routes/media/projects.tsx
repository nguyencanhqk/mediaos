import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ProjectDto } from "@mediaos/contracts";
import { projectsApi, type ProjectFilters } from "@/lib/projects-api";
import { PermissionGate } from "@/components/permission-gate";
import { useCan } from "@/hooks/use-can";
import { useEmployeeOptions } from "@/components/channels/use-channel-options";
import { ProjectFilterBar } from "@/components/projects/project-filter-bar";
import { ProjectTable } from "@/components/projects/project-table";
import { CreateProjectDialog } from "@/components/projects/create-project-dialog";

export function ProjectsPage() {
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
    if (window.confirm(`Xoá dự án "${project.name}"?`)) remove.mutate(project.id);
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Dự án</h1>
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

      {isLoading && <p className="text-sm text-muted-foreground">Đang tải…</p>}
      {isError && <p className="text-sm text-destructive">Không tải được dữ liệu.</p>}
      {!isLoading && !isError && projects.length === 0 && (
        <p className="text-sm text-muted-foreground">Không có dự án nào khớp bộ lọc.</p>
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
