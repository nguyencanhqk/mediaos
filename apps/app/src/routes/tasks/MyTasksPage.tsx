import { useCallback, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { ChevronDown, ChevronRight, ListTodo, Plus, RefreshCw, Search } from "lucide-react";
import { companyTimeZone, formatDateTime, taskCoreApi, taskKeys, useCan } from "@mediaos/web-core";
import { Button, Card, Checkbox, EmptyState, Input, PageHeader } from "@mediaos/ui";
import type { MyTaskItemDto } from "@mediaos/contracts";
import { TASK_CORE_ENGINE_PAIRS } from "./constants";
import { TaskPriorityBadge, TaskOverdueBadge } from "./TaskStatusBadge";
import { TaskRowDeadlineControl, TaskRowStatusControl } from "./TaskRowQuickEdit";
import { useTaskDrawer } from "./task-drawer-nav";
import {
  filterMyTasks,
  groupMyTasks,
  MY_TASK_SOURCE_OPTIONS,
  patchMyTasksSearch,
  validateMyTasksSearch,
  type MyTaskGroup,
  type MyTasksSearch,
} from "./my-tasks-groups";
import { useSlashFocus } from "./use-slash-focus";
import { TaskQuickAdd } from "./TaskQuickAdd";
import { TaskFormDrawer } from "./TaskFormDrawer";
import { useMyEmployeeLink } from "./use-my-employee";

/**
 * MyTasksPage — S4-FE-TASK-2 (SPEC-06 §13.9, TASK-SCREEN-009) · S20-TASK-MYTASKS-1 (US-TASK-NV-01).
 *
 * `GET /tasks/my` (TASK-API-210) gộp 3 nguồn assigned/created/watched trong một mảng (mỗi dòng có
 * `source`, server đã dedupe + sắp «quá hạn lên đầu»). Trang nhóm CLIENT-SIDE theo hạn — quy tắc ở
 * `my-tasks-groups.ts`. Bộ lọc (`?group=&source=&showDone=`) sống trên URL: tải lại hay gửi link vẫn ra
 * cùng màn. Mở việc = drawer dùng chung (`?task=`, S20-TASK-DRAWER-1).
 *
 * Cổng route = TASK.TASK.VIEW (→ read:task): thiếu quyền ⇒ màn «không có quyền», query bị tắt nên
 * KHÔNG có lời gọi API. Tài khoản chưa liên kết hồ sơ nhân viên ⇒ server trả mảng rỗng (không lỗi)
 * ⇒ trạng thái rỗng kèm hướng dẫn.
 *
 * S20-TASK-QUICKEDIT-1 — badge trạng thái + chip hạn trên dòng sửa được tại chỗ (TaskRowQuickEdit):
 * lạc quan, việc đổi nhóm ngay; thiếu cặp quyền ⇒ chữ tĩnh như cũ.
 *
 * S20-TASK-QUICKADD-1 (US-TASK-NV-05) — có `create:task` ⇒ ô tạo một dòng ở đầu trang (kể cả khi chưa
 * có việc nào): người phụ trách = employeeId của tôi từ `/auth/me` (không cần `read:employee`), phím
 * «n» focus ô; chưa liên kết hồ sơ ⇒ ô khoá kèm giải thích, 0 request. Nút «Tạo việc» mở form Tạo tại chỗ.
 */

/** Bộ lọc của trang ĐỌC/GHI trên URL — cùng `validateMyTasksSearch` mà route khai báo. */
function useMyTasksSearch() {
  const navigate = useNavigate();
  const raw = useRouterState({ select: (s) => s.location.search });
  const search = useMemo(
    () => validateMyTasksSearch((raw ?? {}) as Record<string, unknown>),
    [raw],
  );
  // Đổi bộ lọc rời rạc = PUSH (Back hoàn tác); giữ tham số khác của URL (vd `?task=`).
  const update = useCallback(
    (patch: Partial<MyTasksSearch>) =>
      void navigate({
        to: ".",
        search: ((prev: Record<string, unknown>) => patchMyTasksSearch(prev, patch)) as never,
        replace: false,
        resetScroll: false,
      }),
    [navigate],
  );
  return { search, update };
}

function Chip({
  active,
  onClick,
  children,
  testId,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      data-testid={testId}
      className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors ${
        active
          ? "border-primary bg-primary/10 text-foreground"
          : "border-border text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function TaskRow({ item, onOpen }: { item: MyTaskItemDto; onOpen: (id: string) => void }) {
  const { t } = useTranslation("tasks");
  return (
    <Card className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="space-y-1">
        <button
          type="button"
          className="text-left font-medium text-foreground underline-offset-2 hover:underline"
          onClick={() => onOpen(item.id)}
        >
          {item.title}
        </button>
        <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
          <span>{item.projectName ?? t("tasks.my.noProject")}</span>
          <span aria-hidden="true">·</span>
          <TaskRowDeadlineControl
            task={item}
            readOnly={
              item.dueAt ? (
                <span>
                  {t("myTasks.due", { value: formatDateTime(item.dueAt, companyTimeZone()) })}
                </span>
              ) : null
            }
          />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <TaskPriorityBadge priority={item.priority} />
        <TaskRowStatusControl task={item} />
        <TaskOverdueBadge isOverdue={item.isOverdue} />
      </div>
    </Card>
  );
}

/** Một nhóm: đầu nhóm có số đếm; nhóm rỗng thu gọn (không mở được), nhóm có việc bấm để thu/mở. */
function GroupSection({ group, onOpen }: { group: MyTaskGroup; onOpen: (id: string) => void }) {
  const { t } = useTranslation("tasks");
  const listId = useId();
  const [collapsed, setCollapsed] = useState(false);
  const empty = group.items.length === 0;
  const expanded = !empty && !collapsed;
  const Icon = expanded ? ChevronDown : ChevronRight;
  return (
    <section
      data-testid={`my-tasks-group-${group.key}`}
      data-group={group.key}
      className="space-y-2"
    >
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={listId}
        disabled={empty}
        onClick={() => setCollapsed((c) => !c)}
        className="flex items-center gap-2 text-sm font-semibold text-foreground disabled:cursor-default disabled:font-normal disabled:text-muted-foreground"
      >
        <Icon className="h-4 w-4" aria-hidden="true" />
        <span>{t(`myTasks.groups.${group.key}`)}</span>
        <span
          data-testid={`my-tasks-group-count-${group.key}`}
          className="rounded-full bg-muted px-2 text-xs font-medium"
        >
          {group.items.length}
        </span>
      </button>
      {expanded && (
        <div id={listId} className="space-y-2">
          {group.items.map((item) => (
            <TaskRow key={item.id} item={item} onOpen={onOpen} />
          ))}
        </div>
      )}
    </section>
  );
}

function Toolbar({
  search,
  update,
  groups,
  showDone,
  query,
  onQuery,
}: {
  search: MyTasksSearch;
  update: (patch: Partial<MyTasksSearch>) => void;
  groups: readonly MyTaskGroup[];
  showDone: boolean;
  query: string;
  onQuery: (next: string) => void;
}) {
  const { t } = useTranslation("tasks");
  const inputRef = useRef<HTMLInputElement>(null);
  useSlashFocus(inputRef);
  const toggleDone = (next: boolean) =>
    update(
      next
        ? { showDone: 1 }
        : { showDone: undefined, ...(search.group === "done" ? { group: undefined } : {}) },
    );
  return (
    <div className="space-y-3">
      <div
        className="flex flex-wrap items-center gap-2"
        role="group"
        aria-label={t("myTasks.sourceFilterLabel")}
      >
        <Chip active={search.source === undefined} onClick={() => update({ source: undefined })}>
          {t("myTasks.allSources")}
        </Chip>
        {MY_TASK_SOURCE_OPTIONS.map((source) => (
          <Chip key={source} active={search.source === source} onClick={() => update({ source })}>
            {t(`myTasks.sources.${source}`)}
          </Chip>
        ))}
        <label className="ml-auto inline-flex items-center gap-2 text-sm text-muted-foreground">
          <Checkbox checked={showDone} onChange={(e) => toggleDone(e.target.checked)} />
          <span>{t("myTasks.showDone")}</span>
        </label>
      </div>
      <div
        className="flex flex-wrap items-center gap-2"
        role="group"
        aria-label={t("myTasks.groupFilterLabel")}
      >
        <Chip active={search.group === undefined} onClick={() => update({ group: undefined })}>
          {t("myTasks.allGroups")}
        </Chip>
        {groups.map((g) => (
          <Chip
            key={g.key}
            active={search.group === g.key}
            onClick={() => update({ group: g.key })}
            testId={`my-tasks-groupchip-${g.key}`}
          >
            {t(`myTasks.groups.${g.key}`)}
            <span className="text-xs">{g.items.length}</span>
          </Chip>
        ))}
      </div>
      <div className="relative max-w-sm">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          aria-label={t("myTasks.quickFilterLabel")}
          placeholder={t("myTasks.quickFilterPlaceholder")}
          className="pl-8"
        />
      </div>
    </div>
  );
}

/** Thân trang: khung tải · rỗng-theo-bộ-lọc (nút «Xoá bộ lọc» chỉ khi CÓ bộ lọc) · các nhóm. */
function GroupList({
  groups,
  isLoading,
  hasFilters,
  onClear,
  onOpen,
}: {
  groups: readonly MyTaskGroup[];
  isLoading: boolean;
  hasFilters: boolean;
  onClear: () => void;
  onOpen: (id: string) => void;
}) {
  const { t } = useTranslation("tasks");
  if (isLoading) {
    return (
      <div className="space-y-2">
        <div className="h-16 animate-pulse rounded bg-muted" />
        <div className="h-16 animate-pulse rounded bg-muted" />
      </div>
    );
  }
  if (groups.every((g) => g.items.length === 0)) {
    return (
      <EmptyState
        title={t("myTasks.emptyFiltered.title")}
        description={t("myTasks.emptyFiltered.description")}
        action={
          hasFilters ? (
            <Button variant="outline" size="sm" onClick={onClear}>
              {t("myTasks.emptyFiltered.clear")}
            </Button>
          ) : undefined
        }
      />
    );
  }
  return (
    <div className="space-y-5">
      {groups.map((group) => (
        <GroupSection key={group.key} group={group} onOpen={onOpen} />
      ))}
    </div>
  );
}

/**
 * Ô tạo nhanh của trang: giao cho CHÍNH TÔI — chưa biết tôi là ai thì khoá ô, không đoán.
 * `autoFocus` (`?create=1` — quick action «Tạo task» của dashboard) ⇒ focus ngay khi ô mở khoá.
 */
function MyTasksQuickAdd({ autoFocus }: { autoFocus: boolean }) {
  const { t } = useTranslation("tasks");
  const me = useMyEmployeeLink(true);
  const reasonKey =
    me.status === "unlinked"
      ? "quickAdd.unlinked"
      : me.status === "error"
        ? "quickAdd.meFailed"
        : "quickAdd.loading";
  return (
    <TaskQuickAdd
      id="my-tasks-quick-add"
      fixedAssigneeEmployeeId={me.status === "linked" ? me.employeeId : undefined}
      disabled={me.status !== "linked"}
      disabledReason={t(reasonKey)}
      placeholder={t("quickAdd.placeholder")}
      hint={t("quickAdd.hint")}
      shortcutKey="n"
      autoFocus={autoFocus}
    />
  );
}

export function MyTasksPage() {
  const { t } = useTranslation("tasks");
  const canView = useCan(
    TASK_CORE_ENGINE_PAIRS.READ.action,
    TASK_CORE_ENGINE_PAIRS.READ.resourceType,
  );
  const canCreate = useCan(
    TASK_CORE_ENGINE_PAIRS.CREATE.action,
    TASK_CORE_ENGINE_PAIRS.CREATE.resourceType,
  );
  const [createOpen, setCreateOpen] = useState(false);
  const { search, update } = useMyTasksSearch();
  const [query, setQuery] = useState("");
  // S20-TASK-DRAWER-1 — mở drawer tại chỗ (`?task=`): bộ lọc + vị trí cuộn giữ nguyên.
  const { openTask } = useTaskDrawer();

  const { data, isLoading, isError, refetch, dataUpdatedAt } = useQuery({
    queryKey: taskKeys.my(),
    queryFn: () => taskCoreApi.getMyTasks(),
    enabled: canView,
    staleTime: 30_000,
  });

  const showDone = search.showDone === 1 || search.group === "done";
  // «Bây giờ» = lúc tải dữ liệu: cùng mốc server tính `isOverdue`; tải lại (focus cửa sổ) ⇒ nhóm lại.
  const groups = useMemo(
    () =>
      groupMyTasks(filterMyTasks(data ?? [], { source: search.source, query }), {
        now: new Date(dataUpdatedAt || Date.now()),
        timeZone: companyTimeZone(),
        showDone,
      }),
    [data, dataUpdatedAt, search.source, query, showDone],
  );

  if (!canView) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("tasks.my.forbidden.title")}
          description={t("tasks.my.forbidden.description")}
        />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("tasks.my.error.title")}
          description={t("tasks.my.error.description")}
          action={
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              {t("actions.retry", { ns: "common" })}
            </Button>
          }
        />
      </div>
    );
  }

  const hasFilters =
    search.group !== undefined || search.source !== undefined || query.trim() !== "";
  const clearFilters = () => {
    setQuery("");
    update({ group: undefined, source: undefined });
  };

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={t("tasks.my.title")}
        description={t("tasks.my.description")}
        icon={ListTodo}
        actions={
          canCreate ? (
            <Button size="sm" onClick={() => setCreateOpen(true)} data-testid="my-tasks-create">
              <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
              {t("quickAdd.createButton")}
            </Button>
          ) : undefined
        }
      />
      {canCreate && <MyTasksQuickAdd autoFocus={search.create === 1} />}
      {createOpen && (
        <TaskFormDrawer
          mode="create"
          onClose={() => setCreateOpen(false)}
          onSuccess={() => setCreateOpen(false)}
        />
      )}
      {!isLoading && (data ?? []).length === 0 ? (
        <EmptyState
          icon={ListTodo}
          title={t("myTasks.empty.title")}
          description={t("myTasks.empty.description")}
        />
      ) : (
        <>
          <Toolbar
            search={search}
            update={update}
            groups={groups}
            showDone={showDone}
            query={query}
            onQuery={setQuery}
          />
          <GroupList
            groups={search.group ? groups.filter((g) => g.key === search.group) : groups}
            isLoading={isLoading}
            hasFilters={hasFilters}
            onClear={clearFilters}
            onOpen={openTask}
          />
        </>
      )}
    </div>
  );
}
