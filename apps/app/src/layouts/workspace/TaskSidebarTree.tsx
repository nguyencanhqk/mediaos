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
  KeyRound,
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
import { TASK_PROJECT_PAGE_LIMIT_MAX, type TaskProjectListItemDto } from "@mediaos/contracts";
import { isProjectOwner, TASK_ENGINE_PAIRS } from "@/routes/tasks/constants";
import { ProjectFormDrawer } from "@/routes/tasks/ProjectFormDrawer";
import { useLocalPref } from "@/hooks/use-local-pref";
import { isPathActive } from "./ModuleSidebar";
import { usePersistedSet } from "./use-persisted-set";

/**
 * TaskSidebarTree — S5-TASK-NAV-TREE-1 (đợt B): cây phòng ban trong sidebar TASK, dự án lồng dưới
 * đúng phòng ban theo `departmentId`; mỗi phòng ban có menu ⋯ (xem báo cáo · thêm dự án prefill
 * phòng ban · sắp xếp). Doc chuẩn sidebar TASK: FRONTEND-11 §8.1 (bản hợp nhất đợt B).
 *
 * - Gate hiển thị = read:project (cùng cặp item "Dự án" tĩnh); server đã cắt danh sách theo
 *   data-scope nên cây chỉ chứa dự án actor được thấy. Cây phòng ban lấy từ GET /org/units/tree
 *   (read-mở — xem hr-org-api.ts); CHỈ node type "department" được hiện — node loại khác (team…)
 *   bị bỏ nhưng CON là department được "kéo lên" thế chỗ; dự án trỏ node bị bỏ rơi vào nhóm
 *   "Chưa phân phòng ban" (menu Thêm dự án vì thế không bao giờ prefill id ngoài lookup phòng ban).
 * - Menu ⋯: từng mục gate quyền riêng, thiếu quyền thì ẨN mục (UI-02 §5.3). "Xem báo cáo" =
 *   deep-link /tasks/projects?departmentId=X (danh sách + tiến độ dự án phòng ban — báo cáo tổng
 *   hợp phòng ban thuộc đợt D, KHÔNG vẽ giả). "Sắp xếp" áp RIÊNG từng phòng ban (map lưu 1 key
 *   localStorage qua useLocalPref).
 * - Phòng ban 0 dự án VẪN hiện (điểm neo "thêm dự án"). Gập/mở giữ trạng thái (usePersistedSet).
 * - Số lượng: limit = TASK_PROJECT_PAGE_LIMIT_MAX (trần server, import từ contracts — không chép
 *   số); chạm trần thì hiện dòng báo cắt, không cắt im lặng. staleTime 5' cả 2 query — dữ liệu đổi
 *   qua mutation đã có taskProjectInvalidation, không cần refetch-on-focus dồn dập.
 * - S5-TASK-PROJROLE-1 (đợt C): node DỰ ÁN cũng có menu ⋯ — ĐÚNG 1 mục "Cài đặt quyền" (deep-link
 *   `?tab=members`), HIỆN khi manage-member:project HOẶC `myProjectRole==='Owner'` (list DTO); thiếu
 *   cả hai ⇒ ẨN mục + ẩn luôn nút ⋯ (`ProjectMenu` trả `null`, không lộ menu rỗng — UI-02 §5.3).
 */

const COLLAPSED_KEY = "mediaos.sidebar.taskTree.collapsed";
const SORT_KEY = "mediaos.sidebar.taskTree.sortByDept";
const TREE_STALE_TIME = 5 * 60 * 1000;

const MENU_ITEM_CLASS =
  "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-accent hover:text-foreground";

type TreeSort = "newest" | "name";
type SortByDept = Record<string, TreeSort>;

function sortProjects(
  projects: readonly TaskProjectListItemDto[],
  sort: TreeSort,
): TaskProjectListItemDto[] {
  const copy = [...projects];
  if (sort === "name") return copy.sort((a, b) => a.name.localeCompare(b.name, "vi"));
  return copy.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Chỉ giữ node type "department"; node loại khác bị bỏ nhưng CON department được kéo lên thế chỗ
 * (giữ nguyên thứ tự duyệt). Trả cây mới — không đụng dữ liệu query cache.
 */
function normalizeDepartments(nodes: readonly OrgTreeNode[]): OrgTreeNode[] {
  const out: OrgTreeNode[] = [];
  for (const n of nodes) {
    const children = normalizeDepartments(n.children);
    if (n.type === "department") out.push({ ...n, children });
    else out.push(...children);
  }
  return out;
}

/** Gom id mọi department trong cây đã chuẩn hoá — nhận diện dự án trỏ ngoài cây. */
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
      className={MENU_ITEM_CLASS}
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
            // Touch không có hover → dưới lg luôn hiện mờ; desktop mới ẩn chờ hover/focus.
            "opacity-60 lg:opacity-0 lg:focus-visible:opacity-100 lg:group-hover/dept:opacity-100",
            open && "opacity-100 lg:opacity-100",
          )}
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      }
    >
      <div role="menu" className="space-y-0.5">
        <button type="button" role="menuitem" onClick={goReport} className={MENU_ITEM_CLASS}>
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
            className={MENU_ITEM_CLASS}
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

/**
 * S5-TASK-PROJROLE-1 (đợt C) — menu ⋯ node DỰ ÁN, ĐÚNG 1 mục "Cài đặt quyền" → điều hướng
 * `?tab=members` (tab Thành viên vỏ workspace). HIỆN khi có manage-member:project (pair hệ thống)
 * HOẶC `myProjectRole==='Owner'` (list DTO server trả — BE quyết cuối, đây chỉ ẩn/hiện). Thiếu cả
 * hai ⇒ ẨN MỤC + ẨN LUÔN NÚT ⋯ (UI-02 §5.3 — không lộ menu rỗng).
 */
function ProjectMenu({ project }: { project: TaskProjectListItemDto }) {
  const { t } = useTranslation("tasks");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const canManageMembersPair = useCan(
    TASK_ENGINE_PAIRS.MANAGE_MEMBER_PROJECT.action,
    TASK_ENGINE_PAIRS.MANAGE_MEMBER_PROJECT.resourceType,
  );
  const showSettings = canManageMembersPair || isProjectOwner(project.myProjectRole);
  if (!showSettings) return null;

  const goSettings = () => {
    setOpen(false);
    router.history.push(`/tasks/projects/${project.id}?tab=members`);
  };

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="end"
      className="min-w-[13rem] p-1.5"
      trigger={
        <button
          type="button"
          aria-label={t("sidebarTree.projectMenuLabel", { name: project.name })}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className={cn(
            "rounded p-1 text-muted-foreground/60 hover:bg-accent hover:text-foreground",
            "opacity-60 lg:opacity-0 lg:focus-visible:opacity-100 lg:group-hover/project:opacity-100",
            open && "opacity-100 lg:opacity-100",
          )}
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      }
    >
      <div role="menu" className="space-y-0.5">
        <button type="button" role="menuitem" onClick={goSettings} className={MENU_ITEM_CLASS}>
          <KeyRound className="h-4 w-4" />
          {t("sidebarTree.projectMenu.permissionSettings")}
        </button>
      </div>
    </Popover>
  );
}

function ProjectLeaf({ project, pathname }: { project: TaskProjectListItemDto; pathname: string }) {
  const isActive = isPathActive(pathname, `/tasks/projects/${project.id}`);
  return (
    <div className="group/project flex items-center gap-0.5 pr-1">
      <Link
        to="/tasks/projects/$projectId"
        params={{ projectId: project.id }}
        aria-current={isActive ? "page" : undefined}
        title={project.name}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors",
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
      <ProjectMenu project={project} />
    </div>
  );
}

function DeptNode({
  dept,
  pathname,
  projectsByDept,
  isCollapsed,
  onToggle,
  sortFor,
  onChangeSort,
  onAddProject,
}: {
  dept: OrgTreeNode;
  pathname: string;
  projectsByDept: ReadonlyMap<string, TaskProjectListItemDto[]>;
  isCollapsed: (id: string) => boolean;
  onToggle: (id: string) => void;
  sortFor: (deptId: string) => TreeSort;
  onChangeSort: (deptId: string, s: TreeSort) => void;
  onAddProject: (departmentId: string) => void;
}) {
  const { t } = useTranslation("tasks");
  const sort = sortFor(dept.id);
  const projects = sortProjects(projectsByDept.get(dept.id) ?? [], sort);
  const isOpen = !isCollapsed(dept.id);
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
        <DeptMenu
          dept={dept}
          sort={sort}
          onChangeSort={(s) => onChangeSort(dept.id, s)}
          onAddProject={onAddProject}
        />
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
              pathname={pathname}
              projectsByDept={projectsByDept}
              isCollapsed={isCollapsed}
              onToggle={onToggle}
              sortFor={sortFor}
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

  const { has: isCollapsed, toggle } = usePersistedSet(COLLAPSED_KEY);
  const [sortByDept, setSortByDept] = useLocalPref<SortByDept>(SORT_KEY, {});
  const [createForDept, setCreateForDept] = useState<string | null>(null);

  const treeQuery = useQuery({
    queryKey: hrKeys.orgChart.tree(),
    queryFn: () => orgApi.getTree(),
    enabled: canRead,
    staleTime: TREE_STALE_TIME,
  });

  const projectParams = { limit: TASK_PROJECT_PAGE_LIMIT_MAX, offset: 0 };
  const projectsQuery = useQuery({
    queryKey: taskKeys.projects.list(projectParams),
    queryFn: () => taskProjectApi.listProjects(projectParams),
    enabled: canRead,
    staleTime: TREE_STALE_TIME,
  });

  // Gom nhóm KHÔNG sort — sort per-phòng-ban nằm ở DeptNode (đổi sort 1 phòng không rebuild cả cây).
  const { units, projectsByDept, unassigned, totalProjects } = useMemo(() => {
    const units = normalizeDepartments(treeQuery.data ?? []);
    const projects = projectsQuery.data ?? [];
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
    return {
      units,
      projectsByDept: byDept,
      unassigned: sortProjects(orphans, "newest"),
      totalProjects: projects.length,
    };
  }, [treeQuery.data, projectsQuery.data]);

  if (!canRead) return null;

  const sortFor = (deptId: string): TreeSort => sortByDept[deptId] ?? "newest";
  const changeSort = (deptId: string, s: TreeSort) => {
    setSortByDept({ ...sortByDept, [deptId]: s });
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
              pathname={pathname}
              projectsByDept={projectsByDept}
              isCollapsed={isCollapsed}
              onToggle={toggle}
              sortFor={sortFor}
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
          {totalProjects >= TASK_PROJECT_PAGE_LIMIT_MAX && (
            <p className="px-3 pt-1 text-[11px] text-muted-foreground/70">
              {t("sidebarTree.truncated", { count: TASK_PROJECT_PAGE_LIMIT_MAX })}
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
