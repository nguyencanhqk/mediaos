import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowUpDown,
  BarChart3,
  Check,
  ChevronRight,
  FolderKanban,
  MoreHorizontal,
  Plus,
  RefreshCw,
} from "lucide-react";
import {
  orgApi,
  hrKeys,
  taskProjectApi,
  taskKeys,
  useCan,
  PermissionGate,
  type OrgTreeNode,
} from "@mediaos/web-core";
import { cn, Popover, Skeleton } from "@mediaos/ui";
import type { TaskProjectListItemDto } from "@mediaos/contracts";
import { TASK_ENGINE_PAIRS } from "@/routes/tasks/constants";
import { ProjectFormDrawer } from "@/routes/tasks/ProjectFormDrawer";

/**
 * TaskSidebarTree — S5-TASK-NAV-TREE-1 (đợt B): cây phòng ban trong sidebar TASK, dự án lồng dưới
 * đúng phòng ban theo `departmentId`; mỗi phòng ban có menu ⋯ (xem báo cáo · thêm dự án prefill
 * phòng ban · sắp xếp). Doc chuẩn sidebar TASK: FRONTEND-11 §8.1 (bản hợp nhất đợt B).
 *
 * - Gate hiển thị = read:project (cùng cặp item "Dự án" tĩnh); server đã cắt danh sách theo
 *   data-scope nên cây chỉ chứa dự án actor được thấy. Cây phòng ban lấy từ GET /org/units/tree
 *   (read-mở — xem hr-org-api.ts).
 * - Menu ⋯: từng mục gate quyền riêng, thiếu quyền thì ẨN mục (UI-02 §5.3 — không lộ menu không
 *   dùng được). "Xem báo cáo" = deep-link /tasks/projects?departmentId=X (danh sách + tiến độ các
 *   dự án phòng ban — báo cáo tổng hợp phòng ban thuộc đợt D, KHÔNG vẽ giả ở đây).
 * - Phòng ban 0 dự án VẪN hiện (điểm neo "thêm dự án" theo phòng ban). Dự án không thuộc phòng
 *   ban nào (hoặc trỏ org_unit ngoài cây) gom vào nhóm "Chưa phân phòng ban".
 * - Gập/mở giữ trạng thái (localStorage, lưu tập ĐANG GẬP — mặc định MỞ). Sắp xếp dự án trong cây
 *   (mới nhất | tên A→Z) là tuỳ chọn client, lưu localStorage, áp cho TOÀN cây.
 */

const COLLAPSED_KEY = "mediaos.sidebar.taskTree.collapsed";
const SORT_KEY = "mediaos.sidebar.taskTree.sort";
/** Trần trang lớn nhất của GET /projects (TASK_PROJECT_PAGE_LIMIT_MAX) — quá trần thì báo rõ, không cắt im lặng. */
const TREE_PROJECT_LIMIT = 200;

type TreeSort = "newest" | "name";

function readSort(): TreeSort {
  try {
    return window.localStorage.getItem(SORT_KEY) === "name" ? "name" : "newest";
  } catch {
    return "newest";
  }
}

function readCollapsed(): ReadonlySet<string> {
  try {
    const raw = window.localStorage.getItem(COLLAPSED_KEY);
    if (raw) return new Set(JSON.parse(raw) as string[]);
  } catch {
    // storage không khả dụng → mặc định mở hết
  }
  return new Set<string>();
}

function sortProjects(
  projects: readonly TaskProjectListItemDto[],
  sort: TreeSort,
): TaskProjectListItemDto[] {
  const copy = [...projects];
  if (sort === "name") return copy.sort((a, b) => a.name.localeCompare(b.name, "vi"));
  return copy.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Gom id mọi org_unit trong cây (đệ quy) — để nhận diện dự án trỏ phòng ban ngoài cây. */
function collectUnitIds(nodes: readonly OrgTreeNode[], into: Set<string>): Set<string> {
  for (const n of nodes) {
    into.add(n.id);
    collectUnitIds(n.children, into);
  }
  return into;
}

function DeptMenu({
  dept,
  sort,
  onChangeSort,
  onAddProject,
}: {
  dept: OrgTreeNode;
  sort: TreeSort;
  onChangeSort: (s: TreeSort) => void;
  onAddProject: (departmentId: string) => void;
}) {
  const { t } = useTranslation("tasks");
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const goReport = () => {
    setOpen(false);
    router.history.push(`/tasks/projects?departmentId=${dept.id}`);
  };

  const sortOption = (value: TreeSort, label: string) => (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={sort === value}
      onClick={() => {
        onChangeSort(value);
        setOpen(false);
      }}
      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
    >
      <Check className={cn("h-3.5 w-3.5", sort === value ? "opacity-100" : "opacity-0")} />
      {label}
    </button>
  );

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="end"
      className="min-w-[13rem] p-1.5"
      trigger={
        <button
          type="button"
          aria-label={t("sidebarTree.menuLabel", { name: dept.name })}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className={cn(
            "rounded p-1 text-muted-foreground/60 hover:bg-accent hover:text-foreground",
            "opacity-0 focus-visible:opacity-100 group-hover/dept:opacity-100",
            open && "opacity-100",
          )}
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      }
    >
      <div role="menu" className="space-y-0.5">
        <button
          type="button"
          role="menuitem"
          onClick={goReport}
          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <BarChart3 className="h-4 w-4" />
          {t("sidebarTree.menu.report")}
        </button>
        <PermissionGate
          action={TASK_ENGINE_PAIRS.CREATE_PROJECT.action}
          resourceType={TASK_ENGINE_PAIRS.CREATE_PROJECT.resourceType}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onAddProject(dept.id);
            }}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Plus className="h-4 w-4" />
            {t("sidebarTree.menu.addProject")}
          </button>
        </PermissionGate>
        <div className="my-1 border-t border-border" />
        <p className="flex items-center gap-2 px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          <ArrowUpDown className="h-3 w-3" />
          {t("sidebarTree.menu.sort")}
        </p>
        {sortOption("newest", t("sidebarTree.sort.newest"))}
        {sortOption("name", t("sidebarTree.sort.nameAsc"))}
      </div>
    </Popover>
  );
}

function ProjectLeaf({ project, pathname }: { project: TaskProjectListItemDto; pathname: string }) {
  const detailPath = `/tasks/projects/${project.id}`;
  const isActive = pathname === detailPath || pathname.startsWith(detailPath + "/");
  return (
    <Link
      to="/tasks/projects/$projectId"
      params={{ projectId: project.id }}
      aria-current={isActive ? "page" : undefined}
      title={project.name}
      className={cn(
        "flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors",
        "text-muted-foreground hover:bg-accent hover:text-foreground",
        isActive && "bg-brand-muted font-medium text-brand",
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 shrink-0 rounded-full",
          isActive ? "bg-brand" : "bg-muted-foreground/50",
        )}
      />
      <span className="truncate">{project.name}</span>
    </Link>
  );
}

function DeptNode({
  dept,
  depth,
  pathname,
  projectsByDept,
  collapsedIds,
  onToggle,
  sort,
  onChangeSort,
  onAddProject,
}: {
  dept: OrgTreeNode;
  depth: number;
  pathname: string;
  projectsByDept: ReadonlyMap<string, TaskProjectListItemDto[]>;
  collapsedIds: ReadonlySet<string>;
  onToggle: (id: string) => void;
  sort: TreeSort;
  onChangeSort: (s: TreeSort) => void;
  onAddProject: (departmentId: string) => void;
}) {
  const { t } = useTranslation("tasks");
  const projects = projectsByDept.get(dept.id) ?? [];
  const isOpen = !collapsedIds.has(dept.id);
  const hasContent = projects.length > 0 || dept.children.length > 0;

  return (
    <div>
      <div className="group/dept flex items-center gap-0.5 pr-1">
        <button
          type="button"
          aria-expanded={isOpen}
          aria-label={t(isOpen ? "sidebarTree.collapse" : "sidebarTree.expand", {
            name: dept.name,
          })}
          onClick={() => onToggle(dept.id)}
          className="rounded p-1 text-muted-foreground/70 hover:bg-accent hover:text-foreground"
        >
          <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", isOpen && "rotate-90")} />
        </button>
        <span className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-sm text-muted-foreground">
          <FolderKanban className="h-4 w-4 shrink-0 text-muted-foreground/70" />
          <span className="truncate" title={dept.name}>
            {dept.name}
          </span>
          <span className="text-xs text-muted-foreground/60">{projects.length}</span>
        </span>
        <DeptMenu dept={dept} sort={sort} onChangeSort={onChangeSort} onAddProject={onAddProject} />
      </div>
      {isOpen && hasContent && (
        <div className="ml-3 space-y-0.5 border-l border-border pl-1.5">
          {projects.map((p) => (
            <ProjectLeaf key={p.id} project={p} pathname={pathname} />
          ))}
          {dept.children.map((child) => (
            <DeptNode
              key={child.id}
              dept={child}
              depth={depth + 1}
              pathname={pathname}
              projectsByDept={projectsByDept}
              collapsedIds={collapsedIds}
              onToggle={onToggle}
              sort={sort}
              onChangeSort={onChangeSort}
              onAddProject={onAddProject}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function TaskSidebarTree() {
  const { t } = useTranslation("tasks");
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const canRead = useCan(
    TASK_ENGINE_PAIRS.READ_PROJECT.action,
    TASK_ENGINE_PAIRS.READ_PROJECT.resourceType,
  );

  const [collapsedIds, setCollapsedIds] = useState<ReadonlySet<string>>(readCollapsed);
  const [sort, setSort] = useState<TreeSort>(readSort);
  const [createForDept, setCreateForDept] = useState<string | null>(null);

  const treeQuery = useQuery({
    queryKey: hrKeys.orgChart.tree(),
    queryFn: () => orgApi.getTree(),
    enabled: canRead,
    staleTime: 5 * 60 * 1000,
  });

  const projectParams = { limit: TREE_PROJECT_LIMIT, offset: 0 };
  const projectsQuery = useQuery({
    queryKey: taskKeys.projects.list(projectParams),
    queryFn: () => taskProjectApi.listProjects(projectParams),
    enabled: canRead,
    staleTime: 30_000,
  });

  const units = useMemo(() => treeQuery.data ?? [], [treeQuery.data]);
  const projects = useMemo(() => projectsQuery.data ?? [], [projectsQuery.data]);

  const { projectsByDept, unassigned } = useMemo(() => {
    const knownIds = collectUnitIds(units, new Set<string>());
    const byDept = new Map<string, TaskProjectListItemDto[]>();
    const orphans: TaskProjectListItemDto[] = [];
    for (const p of projects) {
      if (p.departmentId && knownIds.has(p.departmentId)) {
        const list = byDept.get(p.departmentId) ?? [];
        list.push(p);
        byDept.set(p.departmentId, list);
      } else {
        orphans.push(p);
      }
    }
    for (const [id, list] of byDept) byDept.set(id, sortProjects(list, sort));
    return { projectsByDept: byDept, unassigned: sortProjects(orphans, sort) };
  }, [units, projects, sort]);

  if (!canRead) return null;

  const toggle = (id: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]));
      } catch {
        // bỏ qua — trạng thái chỉ sống trong phiên
      }
      return next;
    });
  };

  const changeSort = (s: TreeSort) => {
    setSort(s);
    try {
      window.localStorage.setItem(SORT_KEY, s);
    } catch {
      // bỏ qua
    }
  };

  const isLoading = treeQuery.isLoading || projectsQuery.isLoading;
  const isError = treeQuery.isError || projectsQuery.isError;

  return (
    <div className="mt-4">
      <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {t("sidebarTree.title")}
      </p>

      {isLoading && (
        <div className="space-y-1.5 px-3" aria-label={t("sidebarTree.loading")}>
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-4/5" />
          <Skeleton className="h-5 w-3/5" />
        </div>
      )}

      {!isLoading && isError && (
        <div className="px-3 py-1 text-xs text-muted-foreground">
          <p role="alert">{t("sidebarTree.error")}</p>
          <button
            type="button"
            onClick={() => {
              void treeQuery.refetch();
              void projectsQuery.refetch();
            }}
            className="mt-1 inline-flex items-center gap-1 text-brand hover:underline"
          >
            <RefreshCw className="h-3 w-3" />
            {t("actions.retry", { ns: "common" })}
          </button>
        </div>
      )}

      {!isLoading && !isError && units.length === 0 && unassigned.length === 0 && (
        <p className="px-3 py-1 text-xs text-muted-foreground">{t("sidebarTree.empty")}</p>
      )}

      {!isLoading && !isError && (
        <div className="space-y-0.5">
          {units.map((dept) => (
            <DeptNode
              key={dept.id}
              dept={dept}
              depth={0}
              pathname={pathname}
              projectsByDept={projectsByDept}
              collapsedIds={collapsedIds}
              onToggle={toggle}
              sort={sort}
              onChangeSort={changeSort}
              onAddProject={setCreateForDept}
            />
          ))}
          {unassigned.length > 0 && (
            <div className="pt-1">
              <p className="px-3 pb-0.5 text-xs text-muted-foreground/70">
                {t("sidebarTree.unassigned")}
              </p>
              <div className="ml-3 space-y-0.5 border-l border-border pl-1.5">
                {unassigned.map((p) => (
                  <ProjectLeaf key={p.id} project={p} pathname={pathname} />
                ))}
              </div>
            </div>
          )}
          {projects.length >= TREE_PROJECT_LIMIT && (
            <p className="px-3 pt-1 text-[11px] text-muted-foreground/70">
              {t("sidebarTree.truncated", { count: TREE_PROJECT_LIMIT })}
            </p>
          )}
        </div>
      )}

      {createForDept && (
        <ProjectFormDrawer
          mode="create"
          initialDepartmentId={createForDept}
          onClose={() => setCreateForDept(null)}
          onSuccess={() => setCreateForDept(null)}
        />
      )}
    </div>
  );
}
