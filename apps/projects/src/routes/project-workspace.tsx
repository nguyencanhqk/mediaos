import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Columns3, List, Plus, Settings as SettingsIcon } from "lucide-react";
import type { BoardTaskDto, ListTasksQueryRequest, PriorityDto } from "@mediaos/contracts";
import { Badge, Button, Select, Skeleton } from "@mediaos/ui";
import { PermissionGate } from "@mediaos/web-core";
import { projectsApi } from "@/lib/projects-api";
import { statesApi } from "@/lib/states-api";
import { labelsApi } from "@/lib/labels-api";
import { tasksApi } from "@/lib/tasks-api";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import { PRIORITY_META, PRIORITY_ORDER } from "@/lib/priority";
import { IssueBoard } from "@/components/issues/issue-board";
import { IssueList } from "@/components/issues/issue-list";
import { IssueDetail } from "@/components/issues/issue-detail";
import { CreateIssueDialog } from "@/components/create-issue-dialog";

type ViewMode = "board" | "list";

interface Filters {
  priority: PriorityDto | "";
  labelId: string;
}

/** Workspace 1 dự án — header + Board/List switch + toolbar filter + panel chi tiết. */
export function ProjectWorkspacePage() {
  const { t } = useTranslation("projects");
  const { projectId } = useParams({ from: "/projects/$projectId" });
  const [view, setView] = useState<ViewMode>("board");
  const [filters, setFilters] = useState<Filters>({ priority: "", labelId: "" });
  const [createOpen, setCreateOpen] = useState(false);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);

  const project = useQuery({
    queryKey: queryKeys.project(projectId),
    queryFn: () => projectsApi.getProject(projectId),
  });

  const states = useQuery({
    queryKey: queryKeys.states(projectId),
    queryFn: () => statesApi.listStates(projectId),
  });

  const labels = useQuery({
    queryKey: queryKeys.labels(projectId),
    queryFn: () => labelsApi.listLabels(projectId),
  });

  // Board endpoint nhận filter server-side (projectId + priority + labelId). limit cao để gom đủ cột.
  const boardFilter: ListTasksQueryRequest = useMemo(() => {
    const f: ListTasksQueryRequest = { projectId, limit: 200 };
    if (filters.priority) f.priority = filters.priority;
    if (filters.labelId) f.labelId = filters.labelId;
    return f;
  }, [projectId, filters]);

  const board = useQuery({
    queryKey: queryKeys.board(projectId, boardFilter),
    queryFn: () => tasksApi.getBoard(boardFilter),
  });

  const tasks: BoardTaskDto[] = board.data ?? [];
  const openTask = openTaskId ? tasks.find((tk) => tk.id === openTaskId) ?? null : null;

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      {/* Header */}
      <div className="border-b border-border px-4 py-3 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
              {t("list.pageTitle")}
            </Link>
            <span className="text-muted-foreground">/</span>
            {project.isLoading ? (
              <Skeleton className="h-5 w-40" />
            ) : (
              <>
                {project.data?.identifier && (
                  <Badge variant="brand" className="font-mono">
                    {project.data.identifier}
                  </Badge>
                )}
                <h1 className="truncate text-lg font-semibold text-foreground">
                  {project.data?.name ?? t("workspace.untitled")}
                </h1>
              </>
            )}
          </div>

          <div className="flex items-center gap-2">
            <PermissionGate action="create" resourceType="task">
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4" />
                {t("workspace.createIssue")}
              </Button>
            </PermissionGate>
            <Link
              to="/projects/$projectId/settings"
              params={{ projectId }}
              className="flex h-9 w-9 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label={t("workspace.settings")}
              title={t("workspace.settings")}
            >
              <SettingsIcon className="h-4 w-4" />
            </Link>
          </div>
        </div>

        {/* Toolbar: view switch + filters */}
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded-lg border border-border p-0.5">
            <ViewButton active={view === "board"} onClick={() => setView("board")}>
              <Columns3 className="h-3.5 w-3.5" />
              {t("workspace.viewBoard")}
            </ViewButton>
            <ViewButton active={view === "list"} onClick={() => setView("list")}>
              <List className="h-3.5 w-3.5" />
              {t("workspace.viewList")}
            </ViewButton>
          </div>

          <Select
            value={filters.priority}
            onChange={(e) =>
              setFilters((f) => ({ ...f, priority: e.target.value as PriorityDto | "" }))
            }
            className="h-9 w-auto"
            aria-label={t("workspace.filterPriority")}
          >
            <option value="">{t("workspace.allPriorities")}</option>
            {PRIORITY_ORDER.map((p) => (
              <option key={p} value={p}>
                {t(PRIORITY_META[p].labelKey)}
              </option>
            ))}
          </Select>

          <Select
            value={filters.labelId}
            onChange={(e) => setFilters((f) => ({ ...f, labelId: e.target.value }))}
            className="h-9 w-auto"
            aria-label={t("workspace.filterLabel")}
          >
            <option value="">{t("workspace.allLabels")}</option>
            {(labels.data ?? []).map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden p-4 sm:px-6">
        {board.isError ? (
          <p className="text-sm text-destructive">{t("workspace.boardError")}</p>
        ) : view === "board" ? (
          board.isLoading || states.isLoading ? (
            <BoardSkeleton />
          ) : (
            <IssueBoard
              projectId={projectId}
              states={states.data ?? []}
              tasks={tasks}
              onOpenIssue={setOpenTaskId}
            />
          )
        ) : (
          <div className="h-full overflow-y-auto">
            <IssueList tasks={tasks} isLoading={board.isLoading} onOpenIssue={setOpenTaskId} />
          </div>
        )}
      </div>

      <CreateIssueDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        projectId={projectId}
        states={states.data ?? []}
      />

      {openTask && (
        <IssueDetail
          task={openTask}
          projectId={projectId}
          states={states.data ?? []}
          labels={labels.data ?? []}
          onClose={() => setOpenTaskId(null)}
        />
      )}
    </div>
  );
}

function ViewButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
        active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function BoardSkeleton() {
  return (
    <div className="flex gap-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="w-80 shrink-0 space-y-2 rounded-xl bg-muted/40 p-2">
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-24 w-full rounded-lg" />
          <Skeleton className="h-24 w-full rounded-lg" />
        </div>
      ))}
    </div>
  );
}
