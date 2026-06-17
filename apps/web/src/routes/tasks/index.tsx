import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Button } from "@mediaos/ui";
import { Input } from "@mediaos/ui";
import { tasksApi } from "@/lib/tasks-api";
import { StepChecklist, stepChecklistQueryKey } from "@/components/tasks/step-checklist";
import { CreateTaskDialog } from "@/components/tasks/create-task-dialog";
import { PermissionGate } from "@mediaos/web-core";
import { allRequiredChecked, workflowChecklistApi } from "@/lib/workflow-checklist-api";
import {
  TASK_STATUS_COLORS,
  TASK_STATUS_LABELS,
} from "@/components/tasks/task-status-constants";
import type { TaskDto, CommentDto, ApprovalRequestDto } from "@mediaos/contracts";

// ─── Grouping (G7-3d: nhiều bước song song → nhiều task cùng 1 nội dung) ────────

interface TaskGroup {
  key: string;
  title: string;
  tasks: TaskDto[];
}

/** Gom task theo nội dung để các bước chạy song song hiện cùng một cụm. */
function groupTasksByContent(tasks: TaskDto[], t: TFunction<"tasks">): TaskGroup[] {
  const groups = new Map<string, TaskGroup>();
  for (const task of tasks) {
    const key = task.contentItemId ?? "__none__";
    const existing = groups.get(key);
    if (existing) {
      existing.tasks = [...existing.tasks, task];
    } else {
      groups.set(key, { key, title: task.contentTitle ?? t("myTasks.otherWork"), tasks: [task] });
    }
  }
  return [...groups.values()];
}

// ─── CommentThread ────────────────────────────────────────────────────────────

function CommentThread({ taskId }: { taskId: string }) {
  const { t } = useTranslation("tasks");
  const qc = useQueryClient();
  const [body, setBody] = useState("");

  const { data: comments = [], isLoading } = useQuery({
    queryKey: ["tasks", taskId, "comments"],
    queryFn: () => tasksApi.getComments(taskId),
  });

  const add = useMutation({
    mutationFn: (b: string) => tasksApi.addComment(taskId, { body: b }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["tasks", taskId, "comments"] });
      setBody("");
    },
  });

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">{t("comment.heading")}</h3>
      {isLoading && <p className="text-xs text-muted-foreground">{t("comment.loading")}</p>}
      <ul className="space-y-2">
        {comments.map((c: CommentDto) => (
          <li key={c.id} className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
            <p className="mb-0.5 font-medium text-foreground/80">
              {c.userFullName ?? t("comment.unknownUser")}
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {new Date(c.createdAt).toLocaleString("vi-VN")}
              </span>
            </p>
            <p className="whitespace-pre-wrap">{c.body}</p>
          </li>
        ))}
        {comments.length === 0 && !isLoading && (
          <li className="text-xs text-muted-foreground">{t("comment.empty")}</li>
        )}
      </ul>
      <div className="flex gap-2">
        <Input
          placeholder={t("comment.placeholder")}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && body.trim()) {
              e.preventDefault();
              add.mutate(body.trim());
            }
          }}
        />
        <Button
          size="sm"
          onClick={() => add.mutate(body.trim())}
          disabled={!body.trim() || add.isPending}
        >
          {t("comment.submitButton")}
        </Button>
      </div>
    </div>
  );
}

// ─── SubmitWorkForm ───────────────────────────────────────────────────────────

function SubmitWorkForm({ task, onDone }: { task: TaskDto; onDone: () => void }) {
  const { t } = useTranslation("tasks");
  const qc = useQueryClient();
  const [url, setUrl] = useState(task.submissionUrl ?? "");
  const [note, setNote] = useState(task.submissionNote ?? "");

  const submit = useMutation({
    mutationFn: () =>
      tasksApi.submitStep(task.stepId!, {
        submissionUrl: url.trim() || null,
        submissionNote: note.trim() || null,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["tasks"] });
      onDone();
    },
  });

  const canSubmit = task.stepStatus === "in_progress" && task.stepId != null;

  // Checklist gate (G7-4b): soi lại submit gate của BE phía client — đọc cùng query key với
  // <StepChecklist> (react-query dedupe → 1 request). Không in_progress → không gate (xem early return).
  const { data: checklist, isSuccess: checklistLoaded } = useQuery({
    queryKey: stepChecklistQueryKey(task.stepId ?? ""),
    queryFn: () => workflowChecklistApi.getStepChecklist(task.stepId!),
    enabled: canSubmit,
  });
  // Fail-closed mirror of the BE 4b gate: stay disabled until the checklist has actually loaded.
  // During the fetch window (or on error) `checklist` is undefined → allRequiredChecked([]) would be
  // vacuously true and open the gate prematurely; require a successful load first.
  const checklistReady = checklistLoaded && allRequiredChecked(checklist?.items ?? []);

  if (!canSubmit) {
    if (task.submissionUrl) {
      return (
        <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
          <p className="mb-1 font-medium">{t("submitWork.submitted")}</p>
          <a
            href={task.submissionUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="break-all text-primary underline"
          >
            {task.submissionUrl}
          </a>
          {task.submissionNote && (
            <p className="mt-1 text-muted-foreground">{task.submissionNote}</p>
          )}
        </div>
      );
    }
    return null;
  }

  return (
    <div className="space-y-3 rounded-lg border border-border p-4">
      <h3 className="text-sm font-semibold">{t("submitWork.heading")}</h3>
      <div className="space-y-2">
        <Input
          placeholder={t("submitWork.urlPlaceholder")}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <Input
          placeholder={t("submitWork.notePlaceholder")}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      <StepChecklist stepId={task.stepId!} editable={canSubmit} />
      <Button
        onClick={() => submit.mutate()}
        disabled={submit.isPending || !checklistReady}
        size="sm"
      >
        {submit.isPending ? t("submitWork.submitting") : t("submitWork.submitButton")}
      </Button>
      {!checklistReady && (
        <p className="text-xs text-amber-600">
          {t("submitWork.checklistPending")}
        </p>
      )}
      {submit.isError && (
        <p className="text-xs text-destructive">
          {submit.error instanceof Error ? submit.error.message : t("submitWork.errorDefault")}
        </p>
      )}
    </div>
  );
}

// ─── TaskDetail ───────────────────────────────────────────────────────────────

function TaskDetail({ task, onClose }: { task: TaskDto; onClose: () => void }) {
  const { t } = useTranslation("tasks");
  return (
    <div className="flex h-full flex-col space-y-5 overflow-y-auto p-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold">{task.title}</h2>
          {task.contentTitle && (
            <p className="mt-0.5 text-sm text-muted-foreground">{task.contentTitle}</p>
          )}
        </div>
        <button
          onClick={onClose}
          className="text-lg leading-none text-muted-foreground hover:text-foreground"
          aria-label={t("taskDetail.closeAriaLabel")}
        >
          ✕
        </button>
      </div>
      <div className="flex flex-wrap gap-2 text-xs">
        <span className={`rounded-full px-2 py-0.5 font-medium ${TASK_STATUS_COLORS[task.status]}`}>
          {TASK_STATUS_LABELS[task.status]}
        </span>
        {task.stepName && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
            {task.stepName}
          </span>
        )}
        {task.origin === "revision" && (
          <span className="rounded-full bg-orange-100 px-2 py-0.5 text-orange-700">
            {t("taskDetail.revisionLabel", { round: task.revisionRound })}
          </span>
        )}
      </div>
      <SubmitWorkForm task={task} onDone={() => {}} />
      <CommentThread taskId={task.id} />
    </div>
  );
}

// ─── TaskCard ─────────────────────────────────────────────────────────────────

function TaskCard({
  task,
  isSelected,
  onClick,
}: {
  task: TaskDto;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full rounded-xl border text-left transition-colors ${
        isSelected ? "border-primary bg-primary/5" : "border-border bg-background hover:bg-muted/50"
      }`}
    >
      <div className="px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{task.title}</p>
            {task.contentTitle && (
              <p className="truncate text-xs text-muted-foreground">{task.contentTitle}</p>
            )}
          </div>
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${TASK_STATUS_COLORS[task.status]}`}
          >
            {TASK_STATUS_LABELS[task.status]}
          </span>
        </div>
        {task.stepName && (
          <p className="mt-1 text-xs text-muted-foreground">{task.stepName}</p>
        )}
      </div>
    </button>
  );
}

// ─── ApprovalCard ─────────────────────────────────────────────────────────────

function ApprovalCard({ req }: { req: ApprovalRequestDto }) {
  const { t } = useTranslation("tasks");
  const qc = useQueryClient();
  const [revisionDesc, setRevisionDesc] = useState("");
  const [revisionComment, setRevisionComment] = useState("");
  const [showRevisionForm, setShowRevisionForm] = useState(false);

  const approve = useMutation({
    mutationFn: () => tasksApi.approve(req.id, { comment: null }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["approval-requests"] }),
  });

  const requestRevision = useMutation({
    mutationFn: () =>
      tasksApi.requestRevision(req.id, {
        description: revisionDesc.trim(),
        comment: revisionComment.trim() || null,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["approval-requests"] });
      setShowRevisionForm(false);
    },
  });

  return (
    <div className="rounded-xl border border-border bg-background p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="text-sm">
          <p className="font-medium">Step: {req.workflowStepId.slice(0, 8)}…</p>
          <p className="text-xs text-muted-foreground">
            {t("approval.submittedAt", { time: new Date(req.createdAt).toLocaleString("vi-VN") })}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-700">
          {t("approval.pending")}
        </span>
      </div>

      {!showRevisionForm ? (
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={() => approve.mutate()}
            disabled={approve.isPending}
            className="flex-1"
          >
            {approve.isPending ? t("approval.approving") : t("approval.approve")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowRevisionForm(true)}
            className="flex-1"
          >
            {t("approval.requestRevision")}
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <Input
            placeholder={t("approval.revisionDescPlaceholder")}
            value={revisionDesc}
            onChange={(e) => setRevisionDesc(e.target.value)}
          />
          <Input
            placeholder={t("approval.revisionCommentPlaceholder")}
            value={revisionComment}
            onChange={(e) => setRevisionComment(e.target.value)}
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => requestRevision.mutate()}
              disabled={!revisionDesc.trim() || requestRevision.isPending}
            >
              {requestRevision.isPending ? t("approval.confirmingRevision") : t("approval.confirmRevision")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowRevisionForm(false)}
            >
              {t("approval.cancelRevision")}
            </Button>
          </div>
          {requestRevision.isError && (
            <p className="text-xs text-destructive">
              {requestRevision.error instanceof Error
                ? requestRevision.error.message
                : t("approval.errorDefault")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── ApprovalQueue ────────────────────────────────────────────────────────────

function ApprovalQueue() {
  const { t } = useTranslation("tasks");
  const { data: requests = [], isLoading, isError } = useQuery({
    queryKey: ["approval-requests"],
    queryFn: () => tasksApi.listApprovalRequests(),
  });

  if (isLoading) return <p className="py-6 text-center text-sm text-muted-foreground">{t("approval.queueLoading")}</p>;
  if (isError) return <p className="py-6 text-center text-sm text-destructive">{t("approval.queueError")}</p>;
  if (requests.length === 0)
    return <p className="py-6 text-center text-sm text-muted-foreground">{t("approval.queueEmpty")}</p>;

  return (
    <div className="space-y-3 p-3">
      {requests.map((req) => (
        <ApprovalCard key={req.id} req={req} />
      ))}
    </div>
  );
}

// ─── TasksPage ────────────────────────────────────────────────────────────────

type Tab = "my-tasks" | "approvals";

export function TasksPage() {
  const { t } = useTranslation("tasks");
  const [tab, setTab] = useState<Tab>("my-tasks");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: tasks = [], isLoading, isError } = useQuery({
    queryKey: ["tasks"],
    queryFn: () => tasksApi.getMyTasks(),
    enabled: tab === "my-tasks",
  });

  const selectedTask = tasks.find((t) => t.id === selectedId) ?? null;
  const taskGroups = useMemo(() => groupTasksByContent(tasks, t), [tasks, t]);

  return (
    <div className="flex h-full">
      {/* Left panel */}
      <div className="flex w-80 shrink-0 flex-col border-r border-border">
        {/* Tab bar */}
        <div className="flex h-14 items-center border-b border-border px-2 gap-1">
          <button
            onClick={() => setTab("my-tasks")}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              tab === "my-tasks"
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-muted"
            }`}
          >
            {t("myTasks.tabLabel")}
          </button>
          <button
            onClick={() => { setTab("approvals"); setSelectedId(null); }}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              tab === "approvals"
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-muted"
            }`}
          >
            {t("myTasks.approvalsTabLabel")}
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {tab === "my-tasks" ? (
            <div className="space-y-2 p-3">
              {/* Giao việc tay (G9-2) — ẩn nút nếu không có quyền create:task (BE vẫn gate) */}
              <PermissionGate action="create" resourceType="task">
                <div className="flex justify-end pb-1">
                  <CreateTaskDialog />
                </div>
              </PermissionGate>
              {isLoading && (
                <p className="py-6 text-center text-sm text-muted-foreground">{t("myTasks.loading")}</p>
              )}
              {isError && (
                <p className="py-6 text-center text-sm text-destructive">{t("myTasks.loadError")}</p>
              )}
              {taskGroups.map((group) => (
                <div key={group.key} className="space-y-2">
                  <div className="flex items-center gap-2 px-1 pt-1">
                    <h2 className="truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {group.title}
                    </h2>
                    {group.tasks.length > 1 && (
                      <span className="shrink-0 rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">
                        {t("myTasks.parallelSteps", { count: group.tasks.length })}
                      </span>
                    )}
                  </div>
                  {group.tasks.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      isSelected={task.id === selectedId}
                      onClick={() => setSelectedId(task.id === selectedId ? null : task.id)}
                    />
                  ))}
                </div>
              ))}
              {tasks.length === 0 && !isLoading && (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  {t("myTasks.empty")}
                </p>
              )}
            </div>
          ) : (
            <ApprovalQueue />
          )}
        </div>
      </div>

      {/* Detail panel */}
      <div className="flex-1 overflow-hidden">
        {tab === "my-tasks" && selectedTask ? (
          <TaskDetail task={selectedTask} onClose={() => setSelectedId(null)} />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            {tab === "my-tasks"
              ? t("myTasks.selectPrompt")
              : t("myTasks.approveSelectPrompt")}
          </div>
        )}
      </div>
    </div>
  );
}
