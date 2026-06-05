import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { tasksApi } from "@/lib/tasks-api";
import type { TaskDto, CommentDto, ApprovalRequestDto } from "@mediaos/contracts";

// ─── Status labels ────────────────────────────────────────────────────────────

const TASK_STATUS_LABELS: Record<TaskDto["status"], string> = {
  not_started: "Chưa bắt đầu",
  in_progress: "Đang làm",
  waiting_review: "Chờ duyệt",
  revision: "Đang sửa",
  approved: "Đã duyệt",
  completed: "Hoàn thành",
};

const TASK_STATUS_COLORS: Record<TaskDto["status"], string> = {
  not_started: "bg-muted text-muted-foreground",
  in_progress: "bg-blue-100 text-blue-700",
  waiting_review: "bg-yellow-100 text-yellow-700",
  revision: "bg-orange-100 text-orange-700",
  approved: "bg-green-100 text-green-700",
  completed: "bg-green-200 text-green-800",
};

// ─── CommentThread ────────────────────────────────────────────────────────────

function CommentThread({ taskId }: { taskId: string }) {
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
      <h3 className="text-sm font-semibold">Bình luận</h3>
      {isLoading && <p className="text-xs text-muted-foreground">Đang tải…</p>}
      <ul className="space-y-2">
        {comments.map((c: CommentDto) => (
          <li key={c.id} className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
            <p className="mb-0.5 font-medium text-foreground/80">
              {c.userFullName ?? "Người dùng"}
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {new Date(c.createdAt).toLocaleString("vi-VN")}
              </span>
            </p>
            <p className="whitespace-pre-wrap">{c.body}</p>
          </li>
        ))}
        {comments.length === 0 && !isLoading && (
          <li className="text-xs text-muted-foreground">Chưa có bình luận nào.</li>
        )}
      </ul>
      <div className="flex gap-2">
        <Input
          placeholder="Thêm bình luận…"
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
          Gửi
        </Button>
      </div>
    </div>
  );
}

// ─── SubmitWorkForm ───────────────────────────────────────────────────────────

function SubmitWorkForm({ task, onDone }: { task: TaskDto; onDone: () => void }) {
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

  if (!canSubmit) {
    if (task.submissionUrl) {
      return (
        <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
          <p className="mb-1 font-medium">Đã nộp work</p>
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
      <h3 className="text-sm font-semibold">Nộp work</h3>
      <div className="space-y-2">
        <Input
          placeholder="Link (Drive, Dropbox, YouTube…)"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <Input
          placeholder="Ghi chú (không bắt buộc)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      <Button onClick={() => submit.mutate()} disabled={submit.isPending} size="sm">
        {submit.isPending ? "Đang gửi…" : "Nộp bài"}
      </Button>
      {submit.isError && (
        <p className="text-xs text-destructive">
          {submit.error instanceof Error ? submit.error.message : "Lỗi khi nộp bài."}
        </p>
      )}
    </div>
  );
}

// ─── TaskDetail ───────────────────────────────────────────────────────────────

function TaskDetail({ task, onClose }: { task: TaskDto; onClose: () => void }) {
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
          aria-label="Đóng"
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
            Sửa lần {task.revisionRound}
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
            Gửi lúc {new Date(req.createdAt).toLocaleString("vi-VN")}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-700">
          Chờ duyệt
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
            {approve.isPending ? "Đang duyệt…" : "Phê duyệt"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowRevisionForm(true)}
            className="flex-1"
          >
            Trả về sửa
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <Input
            placeholder="Mô tả lỗi cần sửa *"
            value={revisionDesc}
            onChange={(e) => setRevisionDesc(e.target.value)}
          />
          <Input
            placeholder="Bình luận cho người thực hiện (tuỳ chọn)"
            value={revisionComment}
            onChange={(e) => setRevisionComment(e.target.value)}
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => requestRevision.mutate()}
              disabled={!revisionDesc.trim() || requestRevision.isPending}
            >
              {requestRevision.isPending ? "Đang gửi…" : "Xác nhận trả về"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowRevisionForm(false)}
            >
              Huỷ
            </Button>
          </div>
          {requestRevision.isError && (
            <p className="text-xs text-destructive">
              {requestRevision.error instanceof Error
                ? requestRevision.error.message
                : "Lỗi khi gửi yêu cầu."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── ApprovalQueue ────────────────────────────────────────────────────────────

function ApprovalQueue() {
  const { data: requests = [], isLoading, isError } = useQuery({
    queryKey: ["approval-requests"],
    queryFn: () => tasksApi.listApprovalRequests(),
  });

  if (isLoading) return <p className="py-6 text-center text-sm text-muted-foreground">Đang tải…</p>;
  if (isError) return <p className="py-6 text-center text-sm text-destructive">Không tải được dữ liệu.</p>;
  if (requests.length === 0)
    return <p className="py-6 text-center text-sm text-muted-foreground">Không có yêu cầu duyệt nào.</p>;

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
  const [tab, setTab] = useState<Tab>("my-tasks");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: tasks = [], isLoading, isError } = useQuery({
    queryKey: ["tasks"],
    queryFn: () => tasksApi.getMyTasks(),
    enabled: tab === "my-tasks",
  });

  const selectedTask = tasks.find((t) => t.id === selectedId) ?? null;

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
            Công việc của tôi
          </button>
          <button
            onClick={() => { setTab("approvals"); setSelectedId(null); }}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              tab === "approvals"
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-muted"
            }`}
          >
            Chờ duyệt
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {tab === "my-tasks" ? (
            <div className="space-y-2 p-3">
              {isLoading && (
                <p className="py-6 text-center text-sm text-muted-foreground">Đang tải…</p>
              )}
              {isError && (
                <p className="py-6 text-center text-sm text-destructive">Không tải được dữ liệu.</p>
              )}
              {tasks.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  isSelected={task.id === selectedId}
                  onClick={() => setSelectedId(task.id === selectedId ? null : task.id)}
                />
              ))}
              {tasks.length === 0 && !isLoading && (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  Bạn chưa có công việc nào.
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
              ? "Chọn một công việc để xem chi tiết"
              : "Duyệt hoặc trả về từ danh sách bên trái"}
          </div>
        )}
      </div>
    </div>
  );
}
