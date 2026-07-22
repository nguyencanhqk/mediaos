import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useRouter, useRouterState } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, Lock, Pencil, RefreshCw, Settings2, Trash2 } from "lucide-react";
import {
  taskProjectApi,
  taskKeys,
  taskProjectInvalidation,
  useCan,
  useCanExact,
  ApiError,
} from "@mediaos/web-core";
import { PageHeader, EmptyState, Button, Card, Badge, Dialog, Input, Select } from "@mediaos/ui";
import type { TaskProjectResponseDto } from "@mediaos/contracts";
import {
  PROJECT_STATE_PAIRS,
  TASK_CORE_ENGINE_PAIRS,
  TASK_CORE_PRIORITY_OPTIONS,
  TASK_CORE_STATUS_OPTIONS,
  TASK_ENGINE_PAIRS,
  isProjectManagerOrOwner,
  isProjectOwner,
} from "./constants";
import { PROJECT_REPORT_PAIR } from "./task-file-constants";
import { ProjectFormDrawer } from "./ProjectFormDrawer";
import { ProjectMemberTable } from "./ProjectMemberTable";
import { ProjectRoleLegend } from "./ProjectRoleLegend";
import { TaskKanbanPage } from "./TaskKanbanPage";
import { TaskStateColumnsDialog } from "./TaskStateColumnsDialog";
import { TaskDetailDrawer } from "./TaskDetailDrawer";
import { ProjectTaskListTab } from "./ProjectTaskListTab";
import { ProjectActivityTimeline } from "./ProjectActivityTimeline";
import { ProjectReportContent } from "./ProjectReportPage";
import { ProjectProgressCard } from "./ProjectProgressCard";
import { ProjectProgressWidget } from "@/components/dashboard/ProjectProgressWidget";
import {
  DEFAULT_WORKSPACE_FILTERS,
  parseWorkspaceTab,
  WORKSPACE_TASK_SORTS,
  type ProjectWorkspaceTab,
  type WorkspaceTaskFilters,
} from "./workspace-constants";
import { useWorkspaceTabOrder } from "./use-workspace-tab-order";

/**
 * ProjectDetailPage — VỎ WORKSPACE dự án (S5-TASK-WORKSPACE-1 đợt D1, SPEC-06 §13.3 TASK-SCREEN-003;
 * gốc S4-FE-TASK-1). Deep link /tasks/projects/:projectId?tab=board|list|report|activity|members.
 *
 * Tab bar: Tổng quan · Bảng · Danh sách · Báo cáo · Hoạt động · Thành viên · Cài đặt — tab phản ánh
 * vào URL (?tab=, history.PUSH ⇒ back/forward đi qua các tab). Tab Báo cáo/Hoạt động ẨN khi thiếu
 * cặp SENSITIVE tương ứng (view-report:project / view:task-audit-log, useCanExact — UI-02 §5.3);
 * deep-link thẳng vào tab bị ẩn → component tab TỰ gate (EmptyState forbidden, không fetch).
 * Tab Cài đặt gom Sửa/Đóng/Xóa dự án (trước ở header) + Quản lý cột pipeline — chỉ hiện khi đủ
 * quyền (pair hệ thống HOẶC myProjectRole đủ bậc, D-24). Tab Gantt·Lịch·Tài liệu·Biểu mẫu thuộc
 * đợt D2-D5 — KHÔNG render giả.
 *
 * Toolbar (tìm·lọc·sắp xếp) + rail avatar (multi-select người thực hiện + "Chưa giao") dùng CHUNG
 * giữa tab Bảng và Danh sách: state sống Ở ĐÂY (vỏ luôn mounted khi đổi tab) — đổi tab giữ nguyên
 * filter. Hai tab lọc client-side qua CÙNG helper `workspace-constants` (parity theo cấu trúc).
 *
 * Overview tab hiển thị field THẬT từ TaskProjectResponseDto; khối "Tiến độ" (S4-FE-DASH-2) nhúng
 * `<ProjectProgressWidget projectId>`; `<ProjectProgressCard>` (S4-FE-TASK-4) — báo cáo NHẠY CẢM
 * useCanExact fail-closed.
 */
function ProjectStatusBadge({ status }: { status: string | null }) {
  const { t } = useTranslation("tasks");
  if (!status) return <span className="text-sm text-muted-foreground">—</span>;
  const variant =
    status === "Active" ? "default" : status === "Cancelled" ? "destructive" : "secondary";
  return <Badge variant={variant}>{t(`projects.status.${status}`)}</Badge>;
}

function CloseProjectDialog({
  project,
  onClose,
}: {
  project: TaskProjectResponseDto;
  onClose: () => void;
}) {
  const { t } = useTranslation("tasks");
  const queryClient = useQueryClient();
  const [note, setNote] = useState("");
  const mutation = useMutation({
    mutationFn: () => taskProjectApi.closeProject(project.id, note ? { note } : undefined),
    onSuccess: async () => {
      await Promise.all(
        taskProjectInvalidation
          .detail(project.id)
          .map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      );
      onClose();
    },
  });
  const noop = () => {};

  return (
    <Dialog
      open
      onClose={mutation.isPending ? noop : onClose}
      title={t("projects.detail.closeDialog.title")}
      description={t("projects.detail.closeDialog.description")}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            {t("projects.detail.closeDialog.cancel")}
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {t("projects.detail.closeDialog.confirm")}
          </Button>
        </>
      }
    >
      {mutation.isError && (
        <p role="alert" className="text-sm text-destructive">
          {t("projects.form.errors.generic")}
        </p>
      )}
      <div className="space-y-1.5">
        <label htmlFor="close-note" className="text-sm font-medium text-foreground">
          {t("projects.detail.closeDialog.noteLabel")}
        </label>
        <textarea
          id="close-note"
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="flex w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
    </Dialog>
  );
}

function DeleteProjectDialog({
  project,
  onClose,
  onDeleted,
}: {
  project: TaskProjectResponseDto;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { t } = useTranslation("tasks");
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => taskProjectApi.deleteProject(project.id),
    onSuccess: async () => {
      await Promise.all(
        taskProjectInvalidation
          .list()
          .map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      );
      onDeleted();
    },
  });
  const noop = () => {};

  return (
    <Dialog
      open
      onClose={mutation.isPending ? noop : onClose}
      title={t("projects.detail.deleteDialog.title")}
      description={t("projects.detail.deleteDialog.description", { name: project.name })}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            {t("projects.detail.deleteDialog.cancel")}
          </Button>
          <Button
            variant="destructive"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
          >
            {t("projects.detail.deleteDialog.confirm")}
          </Button>
        </>
      }
    >
      {mutation.isError && (
        <p role="alert" className="text-sm text-destructive">
          {t("projects.form.errors.generic")}
        </p>
      )}
    </Dialog>
  );
}

function OverviewTab({ project }: { project: TaskProjectResponseDto }) {
  const { t } = useTranslation("tasks");
  const rows: Array<[string, ReactNode]> = [
    [t("projects.detail.fields.code"), project.code ?? "—"],
    [t("projects.detail.fields.owner"), project.ownerName ?? "—"],
    [t("projects.detail.fields.department"), project.departmentName ?? "—"],
    [
      t("projects.detail.fields.status"),
      <ProjectStatusBadge key="status" status={project.status} />,
    ],
    [
      t("projects.detail.fields.priority"),
      project.priority ? t(`projects.priority.${project.priority}`) : "—",
    ],
    [t("projects.detail.fields.startDate"), project.startDate ?? "—"],
    [t("projects.detail.fields.endDate"), project.endDate ?? "—"],
    [t("projects.detail.fields.memberCount"), project.memberCount],
  ];

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card className="space-y-3 p-4 md:col-span-2">
        <h3 className="text-sm font-semibold text-muted-foreground">
          {t("projects.detail.fields.description")}
        </h3>
        <p className="text-sm text-foreground">{project.description ?? "—"}</p>
      </Card>
      {rows.map(([label, value]) => (
        <Card key={String(label)} className="space-y-1 p-4">
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          <div className="text-sm text-foreground">{value}</div>
        </Card>
      ))}
      <div className="md:col-span-2">
        <ProjectProgressWidget projectId={project.id} />
      </div>
      <div className="md:col-span-2">
        <ProjectProgressCard projectId={project.id} />
      </div>
    </div>
  );
}

/**
 * Tab "Cài đặt" — gom hành động quản trị dự án về MỘT chỗ (trước đây: 3 nút Sửa/Đóng/Xóa nằm ở
 * header + Quản lý cột nằm trên board). 3 khối: Thông tin chung (mở ProjectFormDrawer) · Cột quy
 * trình (mở TaskStateColumnsDialog) · Vùng nguy hiểm (Đóng/Xóa). Mỗi khối tự ẩn theo quyền —
 * affordance CHỈ ẩn/hiện, server (assertGovern/permission engine) vẫn là người quyết cuối (D-24).
 */
function ProjectSettingsTab({
  project,
  showEdit,
  showClose,
  showDelete,
  canManageColumns,
  tabOrder,
  isTabOrderCustomized,
  onMoveTab,
  onResetTabOrder,
  onEdit,
  onCloseProject,
  onDeleteProject,
  onManageColumns,
}: {
  project: TaskProjectResponseDto;
  showEdit: boolean;
  showClose: boolean;
  showDelete: boolean;
  canManageColumns: boolean;
  /** Thứ tự tab (tuỳ chọn hiển thị cá nhân, localStorage — useWorkspaceTabOrder). */
  tabOrder: ProjectWorkspaceTab[];
  isTabOrderCustomized: boolean;
  onMoveTab: (tab: ProjectWorkspaceTab, dir: -1 | 1) => void;
  onResetTabOrder: () => void;
  onEdit: () => void;
  onCloseProject: () => void;
  onDeleteProject: () => void;
  onManageColumns: () => void;
}) {
  const { t } = useTranslation("tasks");
  const generalRows: Array<[string, ReactNode]> = [
    [t("projects.form.fields.name"), project.name],
    [t("projects.detail.fields.code"), project.code ?? "—"],
    [t("projects.detail.fields.owner"), project.ownerName ?? "—"],
    [t("projects.detail.fields.department"), project.departmentName ?? "—"],
    [
      t("projects.detail.fields.priority"),
      project.priority ? t(`projects.priority.${project.priority}`) : "—",
    ],
    [t("projects.detail.fields.startDate"), project.startDate ?? "—"],
    [t("projects.detail.fields.endDate"), project.endDate ?? "—"],
  ];

  return (
    <div className="max-w-3xl space-y-4" data-testid="project-settings-tab">
      <Card className="space-y-4 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-foreground">
              {t("projects.detail.settings.general.title")}
            </h3>
            <p className="text-sm text-muted-foreground">
              {t("projects.detail.settings.general.description")}
            </p>
          </div>
          {showEdit && (
            <Button
              variant="outline"
              size="sm"
              onClick={onEdit}
              data-testid="settings-edit-project"
            >
              <Pencil className="mr-2 h-4 w-4" />
              {t("projects.detail.actions.edit")}
            </Button>
          )}
        </div>
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {generalRows.map(([label, value]) => (
            <div key={String(label)} className="flex items-baseline justify-between gap-3">
              <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
              <dd className="text-right text-sm text-foreground">{value}</dd>
            </div>
          ))}
        </dl>
      </Card>

      {canManageColumns && (
        <Card className="flex flex-wrap items-start justify-between gap-3 p-4">
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-foreground">
              {t("projects.detail.settings.pipeline.title")}
            </h3>
            <p className="text-sm text-muted-foreground">
              {t("projects.detail.settings.pipeline.description")}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={onManageColumns}
            data-testid="settings-manage-columns"
          >
            <Settings2 className="mr-2 h-4 w-4" aria-hidden="true" />
            {t("tasks.kanban.manage.button")}
          </Button>
        </Card>
      )}

      <Card className="space-y-3 p-4" data-testid="settings-tab-order">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-foreground">
              {t("projects.detail.settings.tabOrder.title")}
            </h3>
            <p className="text-sm text-muted-foreground">
              {t("projects.detail.settings.tabOrder.description")}
            </p>
          </div>
          {isTabOrderCustomized && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onResetTabOrder}
              data-testid="settings-tab-order-reset"
            >
              {t("projects.detail.settings.tabOrder.reset")}
            </Button>
          )}
        </div>
        <ul className="divide-y divide-border rounded-md border border-border">
          {tabOrder.map((key, index) => (
            <li key={key} className="flex items-center justify-between gap-3 px-3 py-1.5">
              <span className="text-sm text-foreground">{t(`projects.detail.tabs.${key}`)}</span>
              <span className="flex items-center">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 px-0"
                  disabled={index === 0}
                  onClick={() => onMoveTab(key, -1)}
                  aria-label={t("projects.detail.settings.tabOrder.moveUp")}
                  data-testid={`tab-move-up-${key}`}
                >
                  <ChevronUp className="h-4 w-4" aria-hidden="true" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 px-0"
                  disabled={index === tabOrder.length - 1}
                  onClick={() => onMoveTab(key, 1)}
                  aria-label={t("projects.detail.settings.tabOrder.moveDown")}
                  data-testid={`tab-move-down-${key}`}
                >
                  <ChevronDown className="h-4 w-4" aria-hidden="true" />
                </Button>
              </span>
            </li>
          ))}
        </ul>
      </Card>

      {(showClose || showDelete) && (
        <Card className="space-y-3 border-destructive/40 p-4">
          <h3 className="text-sm font-semibold text-destructive">
            {t("projects.detail.settings.danger.title")}
          </h3>
          {showClose && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                {t("projects.detail.settings.danger.closeDescription")}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={onCloseProject}
                data-testid="settings-close-project"
              >
                <Lock className="mr-2 h-4 w-4" />
                {t("projects.detail.actions.close")}
              </Button>
            </div>
          )}
          {showDelete && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                {t("projects.detail.settings.danger.deleteDescription")}
              </p>
              <Button
                variant="destructive"
                size="sm"
                onClick={onDeleteProject}
                data-testid="settings-delete-project"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                {t("projects.detail.actions.delete")}
              </Button>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

/** Toolbar lọc chung tab Bảng·Danh sách (tìm · trạng thái · ưu tiên · quá hạn · sắp xếp · đặt lại). */
function WorkspaceToolbar({
  filters,
  onChange,
}: {
  filters: WorkspaceTaskFilters;
  onChange: (next: WorkspaceTaskFilters) => void;
}) {
  const { t } = useTranslation("tasks");
  const patch = (part: Partial<WorkspaceTaskFilters>) => onChange({ ...filters, ...part });
  const isDirty =
    filters.q !== "" ||
    filters.status !== "" ||
    filters.priority !== "" ||
    filters.overdueOnly ||
    filters.sort !== "default";

  return (
    <div className="flex flex-wrap items-center gap-3" data-testid="workspace-toolbar">
      <Input
        type="search"
        value={filters.q}
        onChange={(e) => patch({ q: e.target.value })}
        placeholder={t("workspace.toolbar.searchPlaceholder")}
        aria-label={t("workspace.toolbar.searchPlaceholder")}
        className="w-56"
        data-testid="workspace-search"
      />
      <Select
        value={filters.status}
        onChange={(e) => patch({ status: e.target.value as WorkspaceTaskFilters["status"] })}
        aria-label={t("tasks.list.filters.status")}
        className="w-40"
        data-testid="workspace-filter-status"
      >
        <option value="">{t("tasks.list.allStatuses")}</option>
        {TASK_CORE_STATUS_OPTIONS.map((s) => (
          <option key={s} value={s}>
            {t(`tasks.status.${s}`)}
          </option>
        ))}
      </Select>
      <Select
        value={filters.priority}
        onChange={(e) => patch({ priority: e.target.value as WorkspaceTaskFilters["priority"] })}
        aria-label={t("tasks.list.filters.priority")}
        className="w-36"
        data-testid="workspace-filter-priority"
      >
        <option value="">{t("tasks.list.allPriorities")}</option>
        {TASK_CORE_PRIORITY_OPTIONS.map((p) => (
          <option key={p} value={p}>
            {t(`tasks.priority.${p}`)}
          </option>
        ))}
      </Select>
      <label className="flex items-center gap-2 text-sm text-foreground">
        <input
          type="checkbox"
          checked={filters.overdueOnly}
          onChange={(e) => patch({ overdueOnly: e.target.checked })}
          data-testid="workspace-filter-overdue"
        />
        {t("tasks.list.filters.overdue")}
      </label>
      <Select
        value={filters.sort}
        onChange={(e) => patch({ sort: e.target.value as WorkspaceTaskFilters["sort"] })}
        aria-label={t("workspace.toolbar.sortLabel")}
        className="w-44"
        data-testid="workspace-sort"
      >
        {WORKSPACE_TASK_SORTS.map((sort) => (
          <option key={sort} value={sort}>
            {t(`workspace.toolbar.sort.${sort}`)}
          </option>
        ))}
      </Select>
      {isDirty && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onChange(DEFAULT_WORKSPACE_FILTERS)}
          data-testid="workspace-filters-reset"
        >
          {t("workspace.toolbar.reset")}
        </Button>
      )}
    </div>
  );
}

export function ProjectDetailPage({
  projectId,
  onBack,
}: {
  projectId: string;
  onBack: () => void;
}) {
  const { t } = useTranslation("tasks");
  const canView = useCan(
    TASK_ENGINE_PAIRS.READ_PROJECT.action,
    TASK_ENGINE_PAIRS.READ_PROJECT.resourceType,
  );
  // 2 tab NHẠY CẢM gate EXACT (fail-closed): Báo cáo (view-report:project — TASK-SCREEN-011) và
  // Hoạt động (view:task-audit-log — TASK-SCREEN-012). Thiếu quyền → ẨN tab (UI-02 §5.3).
  const canViewReport = useCanExact(PROJECT_REPORT_PAIR.action, PROJECT_REPORT_PAIR.resourceType);
  const canViewActivity = useCanExact(
    TASK_CORE_ENGINE_PAIRS.VIEW_ACTIVITY_LOG.action,
    TASK_CORE_ENGINE_PAIRS.VIEW_ACTIVITY_LOG.resourceType,
  );
  // S5-TASK-PROJROLE-1 (đợt C, D-24) — affordance Sửa/Đóng/Xóa dự án: pair hệ thống HOẶC vai trò
  // per-project đủ bậc (server `assertGovern`/tầng role service-layer là người quyết cuối, ở đây
  // CHỈ ẩn/hiện). Gọi ĐỦ 3 hook vô điều kiện trước khi OR với myProjectRole (rules-of-hooks).
  const canUpdatePair = useCan(
    TASK_ENGINE_PAIRS.UPDATE_PROJECT.action,
    TASK_ENGINE_PAIRS.UPDATE_PROJECT.resourceType,
  );
  const canClosePair = useCan(
    TASK_ENGINE_PAIRS.CLOSE_PROJECT.action,
    TASK_ENGINE_PAIRS.CLOSE_PROJECT.resourceType,
  );
  const canDeletePair = useCan(
    TASK_ENGINE_PAIRS.DELETE_PROJECT.action,
    TASK_ENGINE_PAIRS.DELETE_PROJECT.resourceType,
  );
  // Tab "Cài đặt" — khối Quản lý cột pipeline (mirror TaskKanbanPage): gọi ĐỦ 3 hook vô điều kiện
  // rồi mới OR với myProjectRole (rules-of-hooks).
  const canCreateState = useCan(
    PROJECT_STATE_PAIRS.CREATE.action,
    PROJECT_STATE_PAIRS.CREATE.resourceType,
  );
  const canUpdateState = useCan(
    PROJECT_STATE_PAIRS.UPDATE.action,
    PROJECT_STATE_PAIRS.UPDATE.resourceType,
  );
  const canDeleteState = useCan(
    PROJECT_STATE_PAIRS.DELETE.action,
    PROJECT_STATE_PAIRS.DELETE.resourceType,
  );

  // Tab là URL-driven (?tab=) — deep-link/share được; history.PUSH nên back/forward đi qua tab
  // (done_when #1). Đọc qua useRouterState (route đã có validateSearch — router.tsx) mirror pattern
  // đợt B ProjectListPage; giá trị rác → "overview".
  const router = useRouter();
  const locationSearch = useRouterState({ select: (s) => s.location.search });
  const tab = parseWorkspaceTab((locationSearch as Record<string, unknown> | undefined)?.tab);
  // S5-TASK-BOARD-UX-1 — `?task=<id>` mở panel chi tiết ĐÈ LÊN board (không rời trang). Để URL cầm
  // trạng thái này (thay vì useState) thì: copy link ra đúng board + đúng task, và Back của trình
  // duyệt đóng panel. validateSearch của route (router.tsx) là NGUỒN DUY NHẤT về shape search —
  // param nào không khai ở đó sẽ bị strip lượt sau, nên `task` đã được khai thêm cùng lúc với thay
  // đổi này.
  const rawTask = (locationSearch as Record<string, unknown> | undefined)?.task;
  const openTaskId = typeof rawTask === "string" && rawTask.length > 0 ? rawTask : null;

  const buildUrl = (nextTab: ProjectWorkspaceTab, nextTaskId: string | null) => {
    const params = new URLSearchParams();
    if (nextTab !== "overview") params.set("tab", nextTab);
    if (nextTaskId) params.set("task", nextTaskId);
    const qs = params.toString();
    return `/tasks/projects/${projectId}${qs ? `?${qs}` : ""}`;
  };

  // Đổi tab thì BỎ `task` — chuyển sang tab khác mà panel còn treo là vô lý.
  const setTab = (next: ProjectWorkspaceTab) => {
    if (next === tab) return;
    router.history.push(buildUrl(next, null));
  };

  // Mở = push (Back đóng panel). Đóng = REPLACE để không nhét thêm một mục lịch sử: nếu push cả hai
  // chiều thì bấm Back sau khi đóng sẽ MỞ LẠI panel — người dùng đọc là "Back không làm gì".
  const openTask = (taskId: string) => router.history.push(buildUrl(tab, taskId));
  const closeTask = () => router.history.replace(buildUrl(tab, null));

  // Thứ tự tab — tuỳ chọn hiển thị cá nhân (localStorage), chỉnh trong thẻ "Thứ tự tab" của Cài đặt.
  const { tabOrder, isCustomized, moveTab, resetTabOrder } = useWorkspaceTabOrder();

  // Bộ lọc toolbar + rail avatar sống Ở VỎ — đổi tab Bảng↔Danh sách giữ nguyên (done_when #2/#3).
  const [filters, setFilters] = useState<WorkspaceTaskFilters>(DEFAULT_WORKSPACE_FILTERS);
  const [assigneeSelection, setAssigneeSelection] = useState<ReadonlySet<string>>(new Set());
  const toggleAssignee = (value: string) =>
    setAssigneeSelection((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  const clearAssignees = () => setAssigneeSelection(new Set());

  const [editOpen, setEditOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: taskKeys.projects.detail(projectId),
    queryFn: () => taskProjectApi.getProject(projectId),
    enabled: canView,
    staleTime: 30_000,
  });

  if (!canView) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("projects.detail.forbidden.title")}
          description={t("projects.detail.forbidden.description")}
        />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-4 p-6">
        <div className="h-8 w-64 animate-pulse rounded bg-muted" />
        <div className="h-40 animate-pulse rounded bg-muted" />
      </div>
    );
  }

  if (isError) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <div className="p-6">
        <EmptyState
          title={notFound ? t("projects.detail.notFound.title") : t("projects.detail.error.title")}
          description={
            notFound
              ? t("projects.detail.notFound.description")
              : t("projects.detail.error.description")
          }
          action={
            notFound ? undefined : (
              <Button variant="outline" size="sm" onClick={() => void refetch()}>
                <RefreshCw className="mr-2 h-4 w-4" />
                {t("actions.retry", { ns: "common" })}
              </Button>
            )
          }
        />
      </div>
    );
  }

  if (!data) return null;
  const project = data;
  const canCloseAction = project.status !== "Completed" && project.status !== "Cancelled";
  // D-24: Sửa = Owner/Manager; Đóng/Xóa = Owner-only (govern) — myProjectRole chỉ NỚI hiện, BE quyết cuối.
  const showEdit = canUpdatePair || isProjectManagerOrOwner(project.myProjectRole);
  const showClose = canClosePair || isProjectOwner(project.myProjectRole);
  const showDelete = canDeletePair || isProjectOwner(project.myProjectRole);
  // D-24/D-28: Owner/Manager quản được cột pipeline dù pair *:project_state chưa cấp (dormant seed).
  const canManageColumns =
    canCreateState ||
    canUpdateState ||
    canDeleteState ||
    isProjectManagerOrOwner(project.myProjectRole);
  // Tab "Cài đặt" chỉ hiện khi có ÍT NHẤT một việc làm được trong đó; deep-link ?tab=settings khi
  // không đủ quyền → EmptyState forbidden (mirror pattern report/activity).
  const showSettings = showEdit || showClose || showDelete || canManageColumns;

  return (
    <div className="space-y-6 p-6">
      {/* Nút "Quay lại danh sách" đã BỎ (sidebar/breadcrumb đảm nhận điều hướng); onBack chỉ còn
          dùng sau khi XÓA dự án — trang chi tiết không còn tồn tại để đứng lại. */}
      {/* 3 nút Sửa/Đóng/Xóa dự án đã CHUYỂN vào tab Cài đặt — header chỉ còn tiêu đề. */}
      <PageHeader title={project.name} description={project.code ?? undefined} />

      <div className="flex gap-2 overflow-x-auto border-b border-border">
        {tabOrder
          .filter((key) =>
            key === "report"
              ? canViewReport
              : key === "activity"
                ? canViewActivity
                : key === "settings"
                  ? showSettings
                  : true,
          )
          .map((key) => (
            <button
              key={key}
              type="button"
              aria-current={tab === key ? "page" : undefined}
              data-testid={`workspace-tab-${key}`}
              className={`shrink-0 border-b-2 px-3 py-2 text-sm font-medium ${
                tab === key
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setTab(key)}
            >
              {t(`projects.detail.tabs.${key}`)}
            </button>
          ))}
      </div>

      {(tab === "board" || tab === "list") && (
        <WorkspaceToolbar filters={filters} onChange={setFilters} />
      )}

      {tab === "overview" ? (
        <OverviewTab project={project} />
      ) : tab === "board" ? (
        <TaskKanbanPage
          projectId={project.id}
          filters={filters}
          assigneeSelection={assigneeSelection}
          onToggleAssignee={toggleAssignee}
          onClearAssignees={clearAssignees}
          onOpenTask={openTask}
        />
      ) : tab === "list" ? (
        <ProjectTaskListTab
          projectId={project.id}
          filters={filters}
          assigneeSelection={assigneeSelection}
          onToggleAssignee={toggleAssignee}
          onClearAssignees={clearAssignees}
        />
      ) : tab === "report" ? (
        <ProjectReportContent projectId={project.id} />
      ) : tab === "activity" ? (
        <ProjectActivityTimeline projectId={project.id} />
      ) : tab === "members" ? (
        // tab "members" (S5-TASK-PROJROLE-1 đợt C) — HIỆN cho mọi người xem được dự án; control ghi
        // gate trong ProjectMemberTable qua myProjectRole. Chú giải D-24 kèm theo, KHÔNG logic quyền.
        <div className="space-y-4">
          <ProjectMemberTable projectId={project.id} myProjectRole={project.myProjectRole} />
          <ProjectRoleLegend />
        </div>
      ) : !showSettings ? (
        // Deep-link ?tab=settings khi tab bị ẨN → gate tại chỗ, không lộ control (mirror report).
        <EmptyState
          title={t("projects.detail.settings.forbidden.title")}
          description={t("projects.detail.settings.forbidden.description")}
        />
      ) : (
        <ProjectSettingsTab
          project={project}
          showEdit={showEdit}
          showClose={canCloseAction && showClose}
          showDelete={showDelete}
          canManageColumns={canManageColumns}
          tabOrder={tabOrder}
          isTabOrderCustomized={isCustomized}
          onMoveTab={moveTab}
          onResetTabOrder={resetTabOrder}
          onEdit={() => setEditOpen(true)}
          onCloseProject={() => setCloseOpen(true)}
          onDeleteProject={() => setDeleteOpen(true)}
          onManageColumns={() => setColumnsOpen(true)}
        />
      )}

      {editOpen && (
        <ProjectFormDrawer
          mode="edit"
          project={project}
          onClose={() => setEditOpen(false)}
          onSuccess={() => setEditOpen(false)}
        />
      )}
      {closeOpen && <CloseProjectDialog project={project} onClose={() => setCloseOpen(false)} />}
      {columnsOpen && canManageColumns && (
        <TaskStateColumnsDialog
          projectId={project.id}
          myProjectRole={project.myProjectRole}
          open
          onClose={() => setColumnsOpen(false)}
        />
      )}
      {/* S5-TASK-BOARD-UX-1 — panel chi tiết mở từ board. Đặt ở VỎ workspace (không trong
          TaskKanbanPage) để tab Danh sách sau này dùng lại được cùng một `?task=`. */}
      <TaskDetailDrawer
        taskId={openTaskId}
        onClose={closeTask}
        // Mở toàn trang = PUSH sang /tasks/:taskId — Back quay về board với panel còn mở (?task= giữ
        // nguyên trong entry trước).
        onOpenFull={() => {
          if (openTaskId) router.history.push(`/tasks/${openTaskId}`);
        }}
      />
      {deleteOpen && (
        <DeleteProjectDialog
          project={project}
          onClose={() => setDeleteOpen(false)}
          onDeleted={onBack}
        />
      )}
    </div>
  );
}
