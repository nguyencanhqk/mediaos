import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { TeamDto, ProjectDto } from "@mediaos/contracts";
import { tasksApi } from "@/lib/tasks-api";
import { orgApi } from "@/lib/org-api";
import { projectsApi } from "@/lib/projects-api";
import { TaskTable } from "@/components/tasks/task-table";
import { TaskTypeFilter, type TaskTypeFilterValue } from "@/components/tasks/task-type-filter";
import { PermissionGate } from "@/components/permission-gate";

// ─── Tab definition ──────────────────────────────────────────────────────────

type HubTab = "my" | "team" | "project";

// ─── Shared empty/loading/error states ───────────────────────────────────────

function LoadingState() {
  const { t } = useTranslation("tasks");
  return <p className="py-8 text-center text-sm text-muted-foreground">{t("hub.loading")}</p>;
}

function ErrorState({ message }: { message: string }) {
  return <p className="py-8 text-center text-sm text-destructive">{message}</p>;
}

function EmptyState() {
  const { t } = useTranslation("tasks");
  return <p className="py-8 text-center text-sm text-muted-foreground">{t("hub.empty")}</p>;
}

// ─── My Tasks tab ─────────────────────────────────────────────────────────────

function MyTasksTab() {
  const { t } = useTranslation("tasks");
  const [typeFilter, setTypeFilter] = useState<TaskTypeFilterValue>(null);

  const { data: allTasks = [], isLoading, isError } = useQuery({
    queryKey: ["tasks", "my"],
    queryFn: () => tasksApi.getMyTasks(),
    placeholderData: keepPreviousData,
  });

  const tasks = typeFilter
    ? allTasks.filter((t) => t.taskType === typeFilter)
    : allTasks;

  return (
    <div className="space-y-4">
      <TaskTypeFilter value={typeFilter} onChange={setTypeFilter} />
      {isLoading && <LoadingState />}
      {isError && <ErrorState message={t("hub.errorMyTasks")} />}
      {!isLoading && !isError && tasks.length === 0 && <EmptyState />}
      {!isLoading && !isError && tasks.length > 0 && <TaskTable tasks={tasks} />}
    </div>
  );
}

// ─── Team Tasks tab ───────────────────────────────────────────────────────────

function TeamTasksTab() {
  const { t } = useTranslation("tasks");
  const [selectedTeamId, setSelectedTeamId] = useState<string>("");
  const [typeFilter, setTypeFilter] = useState<TaskTypeFilterValue>(null);
  const [page, setPage] = useState(0);
  const pageSize = 50;

  const { data: teams = [], isLoading: teamsLoading } = useQuery({
    queryKey: ["org", "teams"],
    queryFn: () => orgApi.listTeams(),
  });

  const {
    data: allTasks = [],
    isLoading: tasksLoading,
    isError: tasksError,
  } = useQuery({
    queryKey: ["tasks", "team", selectedTeamId, page],
    queryFn: () =>
      tasksApi.getTeamTasks(selectedTeamId, { limit: pageSize, offset: page * pageSize }),
    enabled: selectedTeamId !== "",
    placeholderData: keepPreviousData,
  });

  const tasks = typeFilter
    ? allTasks.filter((t) => t.taskType === typeFilter)
    : allTasks;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <select
          className="rounded-md border border-border bg-background px-3 py-1.5 text-sm"
          value={selectedTeamId}
          onChange={(e) => {
            setSelectedTeamId(e.target.value);
            setPage(0);
          }}
          aria-label={t("hub.teamSelectAriaLabel")}
        >
          <option value="">{t("hub.teamSelectPlaceholder")}</option>
          {teamsLoading && <option disabled>{t("hub.loadingTeams")}</option>}
          {(teams as TeamDto[]).map((team) => (
            <option key={team.id} value={team.id}>
              {team.name}
            </option>
          ))}
        </select>
        <TaskTypeFilter value={typeFilter} onChange={setTypeFilter} />
      </div>

      {selectedTeamId === "" && (
        <p className="py-8 text-center text-sm text-muted-foreground">{t("hub.selectTeamPrompt")}</p>
      )}
      {selectedTeamId !== "" && tasksLoading && <LoadingState />}
      {selectedTeamId !== "" && tasksError && (
        <ErrorState message={t("hub.errorTeamTasks")} />
      )}
      {selectedTeamId !== "" && !tasksLoading && !tasksError && tasks.length === 0 && <EmptyState />}
      {selectedTeamId !== "" && !tasksLoading && !tasksError && tasks.length > 0 && (
        <>
          <TaskTable tasks={tasks} />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="rounded border px-3 py-1 text-sm disabled:opacity-40"
            >
              {t("hub.pagePrev")}
            </button>
            <button
              type="button"
              disabled={tasks.length < pageSize}
              onClick={() => setPage((p) => p + 1)}
              className="rounded border px-3 py-1 text-sm disabled:opacity-40"
            >
              {t("hub.pageNext")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Project Tasks tab ────────────────────────────────────────────────────────

function ProjectTasksTab() {
  const { t } = useTranslation("tasks");
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [typeFilter, setTypeFilter] = useState<TaskTypeFilterValue>(null);
  const [page, setPage] = useState(0);
  const pageSize = 50;

  const { data: projects = [], isLoading: projectsLoading } = useQuery({
    queryKey: ["projects", "list"],
    queryFn: () => projectsApi.listProjects(),
  });

  const {
    data: allTasks = [],
    isLoading: tasksLoading,
    isError: tasksError,
  } = useQuery({
    queryKey: ["tasks", "project", selectedProjectId, page],
    queryFn: () =>
      tasksApi.getProjectTasks(selectedProjectId, { limit: pageSize, offset: page * pageSize }),
    enabled: selectedProjectId !== "",
    placeholderData: keepPreviousData,
  });

  const tasks = typeFilter
    ? allTasks.filter((t) => t.taskType === typeFilter)
    : allTasks;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <select
          className="rounded-md border border-border bg-background px-3 py-1.5 text-sm"
          value={selectedProjectId}
          onChange={(e) => {
            setSelectedProjectId(e.target.value);
            setPage(0);
          }}
          aria-label={t("hub.projectSelectAriaLabel")}
        >
          <option value="">{t("hub.projectSelectPlaceholder")}</option>
          {projectsLoading && <option disabled>{t("hub.loadingProjects")}</option>}
          {(projects as ProjectDto[]).map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
        <TaskTypeFilter value={typeFilter} onChange={setTypeFilter} />
      </div>

      {selectedProjectId === "" && (
        <p className="py-8 text-center text-sm text-muted-foreground">{t("hub.selectProjectPrompt")}</p>
      )}
      {selectedProjectId !== "" && tasksLoading && <LoadingState />}
      {selectedProjectId !== "" && tasksError && (
        <ErrorState message={t("hub.errorProjectTasks")} />
      )}
      {selectedProjectId !== "" && !tasksLoading && !tasksError && tasks.length === 0 && <EmptyState />}
      {selectedProjectId !== "" && !tasksLoading && !tasksError && tasks.length > 0 && (
        <>
          <TaskTable tasks={tasks} />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="rounded border px-3 py-1 text-sm disabled:opacity-40"
            >
              {t("hub.pagePrev")}
            </button>
            <button
              type="button"
              disabled={tasks.length < pageSize}
              onClick={() => setPage((p) => p + 1)}
              className="rounded border px-3 py-1 text-sm disabled:opacity-40"
            >
              {t("hub.pageNext")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Task Hub page ────────────────────────────────────────────────────────────

/**
 * Task Hub (G9-4) — gom MỌI nguồn việc vào 3 view My/Team/Project trên bảng `tasks` hợp nhất.
 * - My Tasks: task được giao cho user hiện tại (không gate, mọi user xem được việc của mình).
 * - Team Tasks / Project Tasks: gated read:task (server trả 403 nếu thiếu quyền; client ẩn tab
 *   qua PermissionGate nhưng server vẫn là sự thật).
 * Mỗi card (TaskTable) hiện badge task_type + ngữ cảnh từ constants chung (không hard-code rải rác).
 */
export function TaskHubPage() {
  const { t } = useTranslation("tasks");
  const [activeTab, setActiveTab] = useState<HubTab>("my");

  const TAB_LABELS: Record<HubTab, string> = {
    my: t("hub.tabMy"),
    team: t("hub.tabTeam"),
    project: t("hub.tabProject"),
  };

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <header>
        <h1 className="text-xl font-semibold">{t("hub.pageTitle")}</h1>
      </header>

      {/* Tab bar */}
      <div className="flex gap-1 rounded-lg border border-border p-0.5 self-start">
        {(Object.keys(TAB_LABELS) as HubTab[]).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            aria-pressed={activeTab === tab}
            data-testid={`hub-tab-${tab}`}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
              activeTab === tab
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-muted"
            }`}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="min-h-0 flex-1 overflow-auto">
        {activeTab === "my" && <MyTasksTab />}
        {activeTab === "team" && (
          <PermissionGate action="read" resourceType="task" fallback={
            <ErrorState message={t("hub.errorNoTeamPermission")} />
          }>
            <TeamTasksTab />
          </PermissionGate>
        )}
        {activeTab === "project" && (
          <PermissionGate action="read" resourceType="task" fallback={
            <ErrorState message={t("hub.errorNoProjectPermission")} />
          }>
            <ProjectTasksTab />
          </PermissionGate>
        )}
      </div>
    </div>
  );
}
