import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Pencil, Target, Trash2 } from "lucide-react";
import {
  ApiError,
  goalApi,
  goalInvalidation,
  goalKeys,
  hrApi,
  hrKeys,
  PermissionGate,
  useCan,
} from "@mediaos/web-core";
import type {
  GoalDetailResponseDto,
  GoalUpdateResponseDto,
  TaskCoreResponseDto,
} from "@mediaos/contracts";
import {
  Badge,
  Button,
  Card,
  CardContent,
  Dialog,
  EmptyState,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@mediaos/ui";
import { TaskStatusBadge } from "@/routes/tasks/TaskStatusBadge";
import { GOAL_ENGINE_PAIRS } from "./constants";
import { formatDateOnly, formatPeriod, formatProgress } from "./goal-format";
import { GoalFinalizedBadge, GoalLevelBadge, GoalStatusBadge } from "./components/GoalBadges";
import { GoalProgressBar } from "./components/GoalProgressBar";

interface GoalDetailPageProps {
  goalId: string;
  onEdit: (goalId: string) => void;
  onBack: () => void;
}

type DetailTab = "overview" | "linked" | "children" | "checkins";

/**
 * GOAL-SCREEN-002 (S5-GOAL-FE-1) — chi tiết mục tiêu, 4 tab: Tổng quan · Công việc gắn · Mục tiêu con ·
 * Lịch sử check-in. Các tab con/lịch sử là READ-ONLY ở FE-1 (API đủ: GET /goals/:id/updates + list
 * theo parentGoalId); check-in/chốt kỳ/gắn task là FE-2. Goal đã chốt kỳ → badge khóa + disable MỌI
 * nút ghi (Sửa/Xóa). Xóa → invalidate list + tree + detail (goalInvalidation) → về danh sách.
 */
export function GoalDetailPage({ goalId, onEdit, onBack }: GoalDetailPageProps) {
  const { t } = useTranslation("goals");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<DetailTab>("overview");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const canDelete = useCan(GOAL_ENGINE_PAIRS.DELETE.action, GOAL_ENGINE_PAIRS.DELETE.resourceType);

  const goalQuery = useQuery({
    queryKey: goalKeys.detail(goalId),
    queryFn: () => goalApi.getGoal(goalId),
    staleTime: 15_000,
  });
  const goal = goalQuery.data;
  const finalized = Boolean(goal?.finalizedAt);

  const deleteMutation = useMutation({
    mutationFn: () => goalApi.deleteGoal(goalId),
    onSuccess: () => {
      for (const queryKey of goalInvalidation.remove(goalId)) {
        void queryClient.invalidateQueries({ queryKey });
      }
      setConfirmDelete(false);
      onBack();
    },
    onError: (err: unknown) => {
      setDeleteError(
        err instanceof ApiError && err.message ? err.message : t("detail.actions.deleteError"),
      );
    },
  });

  if (goalQuery.isLoading) {
    return <div className="m-4 h-64 animate-pulse rounded-xl bg-muted" />;
  }
  if (goalQuery.isError || !goal) {
    const notFound = goalQuery.error instanceof ApiError && goalQuery.error.status === 404;
    return (
      <div className="p-6">
        <EmptyState
          icon={Target}
          title={notFound ? t("detail.notFound.title") : t("detail.error.title")}
          description={notFound ? t("detail.notFound.description") : t("detail.error.description")}
          action={
            <Button variant="outline" size="sm" onClick={onBack}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              {t("detail.breadcrumbBack")}
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <Button variant="ghost" size="sm" className="-ml-2 h-7" onClick={onBack}>
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            {t("detail.breadcrumbBack")}
          </Button>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold text-foreground">{goal.name}</h1>
            <GoalLevelBadge level={goal.level} />
            <GoalStatusBadge status={goal.status} />
            {finalized && <GoalFinalizedBadge />}
          </div>
          <p className="text-sm text-muted-foreground">{goal.goalCode}</p>
        </div>
        <div className="flex items-center gap-2">
          <PermissionGate
            action={GOAL_ENGINE_PAIRS.UPDATE.action}
            resourceType={GOAL_ENGINE_PAIRS.UPDATE.resourceType}
          >
            <Button size="sm" variant="outline" onClick={() => onEdit(goalId)} disabled={finalized}>
              <Pencil className="mr-2 h-4 w-4" />
              {t("detail.actions.edit")}
            </Button>
          </PermissionGate>
          <PermissionGate
            action={GOAL_ENGINE_PAIRS.DELETE.action}
            resourceType={GOAL_ENGINE_PAIRS.DELETE.resourceType}
          >
            <Button
              size="sm"
              variant="destructive"
              onClick={() => setConfirmDelete(true)}
              disabled={finalized}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              {t("detail.actions.delete")}
            </Button>
          </PermissionGate>
        </div>
      </div>

      {finalized && (
        <div className="rounded-md border border-warning/40 bg-warning-muted px-3 py-2 text-sm text-warning">
          {t("detail.finalizedNote")}
        </div>
      )}

      <Tabs value={tab} onValueChange={(v) => setTab(v as DetailTab)}>
        <TabsList>
          <TabsTrigger value="overview">{t("detail.tabs.overview")}</TabsTrigger>
          <TabsTrigger value="linked">{t("detail.tabs.linkedTasks")}</TabsTrigger>
          <TabsTrigger value="children">
            {t("detail.tabs.children")} ({goal.childCount})
          </TabsTrigger>
          <TabsTrigger value="checkins">{t("detail.tabs.checkins")}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <OverviewTab goal={goal} />
        </TabsContent>
        <TabsContent value="linked">
          <LinkedTasksTab goalId={goalId} active={tab === "linked"} />
        </TabsContent>
        <TabsContent value="children">
          <ChildrenTab
            goalId={goalId}
            active={tab === "children"}
            onOpen={(id) => void navigate({ to: "/goals/$goalId", params: { goalId: id } })}
          />
        </TabsContent>
        <TabsContent value="checkins">
          <CheckinsTab goalId={goalId} active={tab === "checkins"} />
        </TabsContent>
      </Tabs>

      <Dialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={t("detail.actions.delete")}
        description={t("detail.actions.deleteConfirm")}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              {t("actions.cancel", { ns: "common" })}
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending || !canDelete}
            >
              {t("detail.actions.delete")}
            </Button>
          </div>
        }
      >
        {deleteError && (
          <p className="text-sm text-destructive" role="alert">
            {deleteError}
          </p>
        )}
      </Dialog>
    </div>
  );
}

// ── Tab: Tổng quan ────────────────────────────────────────────────────────────
function OverviewTab({ goal }: { goal: GoalDetailResponseDto }) {
  const { t } = useTranslation("goals");
  // Tên người phụ trách — reference lookup (GoalDetailResponseDto chỉ có ownerEmployeeId, KHÔNG có tên).
  // GATE read:employee (mẫu GoalListPage): nhân viên thường thường KHÔNG có company-scope read:employee ⇒
  // GET /hr/employees 403; KHÔNG chạy query + KHÔNG lộ UUID trơ (fallback "—" khi chưa giải được tên).
  const canReadEmployees = useCan("read", "employee");
  const { data: employeesPage } = useQuery({
    queryKey: hrKeys.employees.list({ pageSize: 100, status: "active" }),
    queryFn: () => hrApi.listEmployees({ pageSize: 100, status: "active" }),
    enabled: canReadEmployees,
    staleTime: 60_000,
  });
  const ownerName = useMemo(
    () => employeesPage?.items.find((e) => e.id === goal.ownerEmployeeId)?.fullName ?? null,
    [employeesPage, goal.ownerEmployeeId],
  );

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div>
          <p className="mb-1.5 text-sm font-medium text-muted-foreground">{t("progress.label")}</p>
          <div className="max-w-md">
            <GoalProgressBar progressPercent={goal.progressPercent} />
          </div>
        </div>
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          <Row label={t("detail.overview.code")}>{goal.goalCode}</Row>
          <Row label={t("detail.overview.level")}>
            <GoalLevelBadge level={goal.level} />
          </Row>
          <Row label={t("detail.overview.owner")}>{ownerName ?? "—"}</Row>
          <Row label={t("detail.overview.period")}>
            {formatPeriod(goal.periodStart, goal.periodEnd)}
          </Row>
          <Row label={t("detail.overview.parent")}>
            {goal.parent ? `${goal.parent.goalCode} — ${goal.parent.name}` : "—"}
          </Row>
          <Row label={t("detail.overview.childCount")}>{goal.childCount}</Row>
          <Row label={t("detail.overview.measure")}>
            {t(`measureType.${goal.measureType}`)}
            {goal.unit ? ` (${goal.unit})` : ""}
          </Row>
          <Row label={t("detail.overview.progressMode")}>
            {t(`mode.${goal.progressMode}.label`)}
          </Row>
          <Row label={t("detail.overview.target")}>
            {goal.targetValue === null ? "—" : String(goal.targetValue)}
          </Row>
          <Row label={t("detail.overview.current")}>
            {goal.currentValue === null ? "—" : String(goal.currentValue)}
          </Row>
          <Row label={t("detail.overview.weight")}>{String(goal.weight)}</Row>
          <Row label={t("detail.overview.status")}>
            <div className="flex items-center gap-1.5">
              <GoalStatusBadge status={goal.status} />
              {goal.finalizedAt && <GoalFinalizedBadge />}
            </div>
          </Row>
        </dl>
        <div>
          <p className="mb-1 text-sm font-medium text-muted-foreground">
            {t("detail.overview.description")}
          </p>
          <p className="whitespace-pre-wrap text-sm text-foreground">
            {goal.description || t("detail.overview.noDescription")}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground">{children}</dd>
    </div>
  );
}

// ── Tab: Công việc gắn (read-only, GET /goals/:id/tasks) ────────────────────────
function LinkedTasksTab({ goalId, active }: { goalId: string; active: boolean }) {
  const { t } = useTranslation("goals");
  const query = useQuery({
    queryKey: goalKeys.linkedTasks(goalId),
    queryFn: () => goalApi.listLinkedTasks(goalId),
    enabled: active,
    staleTime: 30_000,
  });
  if (query.isLoading) return <TabSkeleton />;
  if (query.isError) return <TabError message={t("detail.linkedTasks.error")} />;
  const tasks = query.data ?? [];
  if (tasks.length === 0) {
    return (
      <EmptyState
        title={t("detail.linkedTasks.empty.title")}
        description={t("detail.linkedTasks.empty.description")}
      />
    );
  }
  return (
    <SimpleTable
      head={[
        t("detail.linkedTasks.columns.title"),
        t("detail.linkedTasks.columns.status"),
        t("detail.linkedTasks.columns.assignee"),
        t("detail.linkedTasks.columns.project"),
        t("detail.linkedTasks.columns.due"),
      ]}
    >
      {tasks.map((task: TaskCoreResponseDto) => (
        <tr key={task.id} className="border-t border-border">
          <td className="px-3 py-2 text-sm text-foreground">{task.title}</td>
          {/* TaskStatusBadge (dùng chung tasks/) — nhãn ĐÃ i18n theo enum, KHÔNG in enum thô. */}
          <td className="px-3 py-2">
            <TaskStatusBadge status={task.status} />
          </td>
          <td className="px-3 py-2 text-sm text-muted-foreground">{task.assigneeName ?? "—"}</td>
          <td className="px-3 py-2 text-sm text-muted-foreground">{task.projectName ?? "—"}</td>
          <td className="whitespace-nowrap px-3 py-2 text-sm text-muted-foreground">
            {formatDateOnly(task.dueAt ? task.dueAt.slice(0, 10) : null)}
          </td>
        </tr>
      ))}
    </SimpleTable>
  );
}

// ── Tab: Mục tiêu con (list theo parentGoalId) ──────────────────────────────────
function ChildrenTab({
  goalId,
  active,
  onOpen,
}: {
  goalId: string;
  active: boolean;
  onOpen: (goalId: string) => void;
}) {
  const { t } = useTranslation("goals");
  const query = useQuery({
    queryKey: goalKeys.list({ parentGoalId: goalId }),
    queryFn: () => goalApi.listGoals({ parentGoalId: goalId }),
    enabled: active,
    staleTime: 30_000,
  });
  if (query.isLoading) return <TabSkeleton />;
  if (query.isError) return <TabError message={t("detail.children.error")} />;
  const children = query.data ?? [];
  if (children.length === 0) {
    return (
      <EmptyState
        title={t("detail.children.empty.title")}
        description={t("detail.children.empty.description")}
      />
    );
  }
  return (
    <SimpleTable
      head={[
        t("list.columns.name"),
        t("list.columns.level"),
        t("list.columns.progress"),
        t("list.columns.status"),
      ]}
    >
      {children.map((child) => (
        <tr
          key={child.id}
          className="cursor-pointer border-t border-border hover:bg-muted"
          onClick={() => onOpen(child.id)}
        >
          <td className="px-3 py-2 text-sm font-medium text-foreground">{child.name}</td>
          <td className="px-3 py-2">
            <GoalLevelBadge level={child.level} />
          </td>
          <td className="w-48 px-3 py-2">
            <GoalProgressBar progressPercent={child.progressPercent} compact />
          </td>
          <td className="px-3 py-2">
            <GoalStatusBadge status={child.status} />
          </td>
        </tr>
      ))}
    </SimpleTable>
  );
}

// ── Tab: Lịch sử check-in (ledger, GET /goals/:id/updates) ──────────────────────
function CheckinsTab({ goalId, active }: { goalId: string; active: boolean }) {
  const { t } = useTranslation("goals");
  const query = useQuery({
    queryKey: goalKeys.updates(goalId),
    queryFn: () => goalApi.listUpdates(goalId, { limit: 100 }),
    enabled: active,
    staleTime: 30_000,
  });
  if (query.isLoading) return <TabSkeleton />;
  if (query.isError) return <TabError message={t("detail.checkins.error")} />;
  const updates = query.data ?? [];
  if (updates.length === 0) {
    return (
      <EmptyState
        title={t("detail.checkins.empty.title")}
        description={t("detail.checkins.empty.description")}
      />
    );
  }
  return (
    <SimpleTable
      head={[
        t("detail.checkins.columns.type"),
        t("detail.checkins.columns.progress"),
        t("detail.checkins.columns.confidence"),
        t("detail.checkins.columns.note"),
        t("detail.checkins.columns.at"),
      ]}
    >
      {updates.map((u: GoalUpdateResponseDto) => (
        <tr key={u.id} className="border-t border-border align-top">
          <td className="px-3 py-2">
            <Badge variant={u.updateType === "reopen" ? "warning" : "muted"}>
              {t(`detail.checkins.type.${u.updateType}`)}
            </Badge>
          </td>
          <td className="px-3 py-2 text-sm tabular-nums">
            {formatProgress(u.oldProgressPercent)} → {formatProgress(u.newProgressPercent)}
          </td>
          <td className="px-3 py-2 text-sm text-muted-foreground">
            {u.confidence === null ? "—" : `${u.confidence}%`}
          </td>
          <td className="px-3 py-2 text-sm text-foreground">{u.note ?? "—"}</td>
          <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
            {new Date(u.createdAt).toLocaleString("vi-VN")}
          </td>
        </tr>
      ))}
    </SimpleTable>
  );
}

// ── Bảng đơn giản dùng chung cho các tab read-only ──────────────────────────────
function SimpleTable({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full">
        <thead className="bg-muted/50">
          <tr>
            {head.map((h) => (
              <th key={h} className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function TabSkeleton() {
  return (
    <div className="space-y-2 py-3">
      <div className="h-9 w-full animate-pulse rounded bg-muted" />
      <div className="h-9 w-11/12 animate-pulse rounded bg-muted" />
    </div>
  );
}

function TabError({ message }: { message: string }) {
  return (
    <p className="py-6 text-center text-sm text-destructive" role="alert">
      {message}
    </p>
  );
}
