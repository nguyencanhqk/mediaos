import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, RefreshCw, Pencil, Lock, Trash2, BarChart3 } from "lucide-react";
import {
  taskProjectApi,
  taskKeys,
  taskProjectInvalidation,
  useCan,
  useCanExact,
  PermissionGate,
  ApiError,
} from "@mediaos/web-core";
import { PageHeader, EmptyState, Button, Card, Badge, Dialog } from "@mediaos/ui";
import type { TaskProjectResponseDto } from "@mediaos/contracts";
import { TASK_ENGINE_PAIRS } from "./constants";
import { PROJECT_REPORT_PAIR } from "./task-file-constants";
import { ProjectFormDrawer } from "./ProjectFormDrawer";
import { ProjectMemberTable } from "./ProjectMemberTable";
import { TaskKanbanPage } from "./TaskKanbanPage";
import { ProjectProgressCard } from "./ProjectProgressCard";
import { ProjectProgressWidget } from "@/components/dashboard/ProjectProgressWidget";

/**
 * ProjectDetailPage — S4-FE-TASK-1 (SPEC-06 §13.3, TASK-SCREEN-003). Deep link /tasks/projects/:projectId.
 *
 * Tab "Kanban" (S4-FE-TASK-3, SPEC-06 §13.8) mount `<TaskKanbanPage>` — route MỚI KHÔNG thêm vào router.tsx
 * (ngoài paths cho phép của lane); thay vào đó tái dùng route đã có `/tasks/projects/:projectId` qua state
 * tab nội bộ (mirror tab "members" đã có từ S4-FE-TASK-1). Overview tab hiển thị field THẬT từ
 * TaskProjectResponseDto; khối "Tiến độ" (S4-FE-DASH-2) nhúng `<ProjectProgressWidget projectId>` — tổng
 * hợp task theo dự án qua GET /dashboard/widgets/project-progress (S4-DASH-BE-2, KHÔNG raw-query TASK).
 *
 * `<ProjectProgressCard projectId>` (S4-FE-TASK-4, SPEC-06 §16.1) — báo cáo NHẠY CẢM riêng
 * (view-report:project, GET /projects/:id/report, S4-TASK-BE-5): countsByStatus + overdueCount +
 * assigneeWorkload (KHÁC widget ở trên — chỉ manager/hr/admin thấy, useCanExact fail-closed).
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

export function ProjectDetailPage({
  projectId,
  onBack,
}: {
  projectId: string;
  onBack: () => void;
}) {
  const { t } = useTranslation("tasks");
  const navigate = useNavigate();
  const canView = useCan(
    TASK_ENGINE_PAIRS.READ_PROJECT.action,
    TASK_ENGINE_PAIRS.READ_PROJECT.resourceType,
  );
  // Báo cáo tiến độ (TASK-SCREEN-011) NHẠY CẢM — gate EXACT view-report:project (fail-closed, mirror
  // ProjectProgressCard). Thiếu quyền → KHÔNG hiện nút "Xem báo cáo".
  const canViewReport = useCanExact(PROJECT_REPORT_PAIR.action, PROJECT_REPORT_PAIR.resourceType);
  const [tab, setTab] = useState<"overview" | "members" | "kanban">("overview");
  const [editOpen, setEditOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

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

  return (
    <div className="space-y-6 p-6">
      <Button variant="ghost" size="sm" className="w-fit" onClick={onBack}>
        <ArrowLeft className="mr-2 h-4 w-4" />
        {t("projects.detail.backToList")}
      </Button>

      <PageHeader
        title={project.name}
        description={project.code ?? undefined}
        actions={
          <div className="flex items-center gap-2">
            {canViewReport && (
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  void navigate({
                    to: "/tasks/projects/$projectId/report" as "/",
                    params: { projectId: project.id } as never,
                  })
                }
              >
                <BarChart3 className="mr-2 h-4 w-4" />
                {t("projects.detail.actions.viewReport")}
              </Button>
            )}
            <PermissionGate
              action={TASK_ENGINE_PAIRS.UPDATE_PROJECT.action}
              resourceType={TASK_ENGINE_PAIRS.UPDATE_PROJECT.resourceType}
            >
              <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
                <Pencil className="mr-2 h-4 w-4" />
                {t("projects.detail.actions.edit")}
              </Button>
            </PermissionGate>
            {canCloseAction && (
              <PermissionGate
                action={TASK_ENGINE_PAIRS.CLOSE_PROJECT.action}
                resourceType={TASK_ENGINE_PAIRS.CLOSE_PROJECT.resourceType}
              >
                <Button variant="outline" size="sm" onClick={() => setCloseOpen(true)}>
                  <Lock className="mr-2 h-4 w-4" />
                  {t("projects.detail.actions.close")}
                </Button>
              </PermissionGate>
            )}
            <PermissionGate
              action={TASK_ENGINE_PAIRS.DELETE_PROJECT.action}
              resourceType={TASK_ENGINE_PAIRS.DELETE_PROJECT.resourceType}
            >
              <Button variant="outline" size="sm" onClick={() => setDeleteOpen(true)}>
                <Trash2 className="mr-2 h-4 w-4 text-destructive" />
                {t("projects.detail.actions.delete")}
              </Button>
            </PermissionGate>
          </div>
        }
      />

      <div className="flex gap-2 border-b border-border">
        {(["overview", "members", "kanban"] as const).map((key) => (
          <button
            key={key}
            type="button"
            className={`border-b-2 px-3 py-2 text-sm font-medium ${
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

      {tab === "overview" ? (
        <OverviewTab project={project} />
      ) : tab === "members" ? (
        <ProjectMemberTable projectId={project.id} />
      ) : (
        <TaskKanbanPage projectId={project.id} />
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
