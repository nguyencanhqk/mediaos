import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Send, Pencil, Trash2, X } from "lucide-react";
import {
  taskCollabApi,
  taskKeys,
  taskCollabInvalidation,
  hrApi,
  hrKeys,
  useAuthStore,
  useCan,
  ApiError,
} from "@mediaos/web-core";
import { Card, Button, Badge, Popover, Dialog } from "@mediaos/ui";
import type { TaskCommentResponseDto } from "@mediaos/contracts";
import { TASK_CORE_ENGINE_PAIRS } from "./constants";

/**
 * TaskCommentThread — bình luận + mention autocomplete (S4-FE-TASK-3, SPEC-06 §13.7/§14.14,
 * TASK-API-301..304). Thay `CommentsSection` cũ (task-core-api.ts, schema `body` — đã GÃY vì BE-4 đổi
 * response sang `content`/`mentions`) — dùng CHÍNH `taskCollabApi` (schema mới).
 *
 * Quyền: đọc thread KHÔNG gate riêng ở đây (component chỉ mount trong TaskDetailPage khi đã có read:task).
 * Viết/sửa/xoá gate `comment:task` (non-sensitive, useCan). Sửa/xoá comment CỦA NGƯỜI KHÁC — BE cho phép
 * actor scope Company/System xoá (KHÔNG phải sửa, sửa luôn self-only) nhưng FE KHÔNG có info scope chi
 * tiết (chỉ boolean grant) ⇒ ẨN nút sửa/xoá comment người khác theo mặc định AN TOÀN (fail-closed UI) —
 * server vẫn là cổng thật, không mất chức năng cho actor có quyền (chỉ thiếu tiện ích UI, ghi backlog).
 *
 * Mention "trong scope": autocomplete dùng `hrApi.listEmployees` (gate read:employee, server đã lọc theo
 * data-scope) lọc client-side theo chuỗi gõ sau "@" — validate THẬT (403 MENTION-OUT-OF-SCOPE) luôn ở
 * server khi submit.
 *
 * Deep link `?comment_id=` — đọc qua `window.location.search` (KHÔNG dùng TanStack Router useSearch: page
 * này render độc lập ngoài router context trong test, mirror TaskDetailPage nhận taskId qua prop thay vì
 * useParams) → highlight + scroll tới đúng comment khi load xong.
 */
function commentErrorKey(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 400 || err.status === 422) return "tasks.detail.comments.errors.validation";
    if (err.status === 403) return "tasks.detail.comments.errors.forbidden";
    if (err.status === 404) return "tasks.detail.comments.errors.notFound";
    if (err.status >= 500) return "tasks.detail.comments.errors.server";
  }
  return "tasks.detail.comments.errors.generic";
}

interface EmployeeOption {
  id: string;
  fullName: string;
}

/** Tìm token mention đang gõ dở ngay trước con trỏ (`@...` chưa gặp khoảng trắng). */
function findMentionToken(text: string, cursor: number): { atIndex: number; query: string } | null {
  const upto = text.slice(0, cursor);
  const atIndex = upto.lastIndexOf("@");
  if (atIndex === -1) return null;
  const between = upto.slice(atIndex + 1);
  if (/\s/.test(between)) return null;
  return { atIndex, query: between };
}

function MentionSuggestions({
  suggestions,
  onSelect,
}: {
  suggestions: EmployeeOption[];
  onSelect: (emp: EmployeeOption) => void;
}) {
  const { t } = useTranslation("tasks");
  if (suggestions.length === 0) {
    return (
      <p className="p-2 text-xs text-muted-foreground">
        {t("tasks.detail.comments.mention.noMatch")}
      </p>
    );
  }
  return (
    <ul className="max-h-56 space-y-0.5 overflow-y-auto">
      {suggestions.map((emp) => (
        <li key={emp.id}>
          <button
            type="button"
            className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
            onClick={() => onSelect(emp)}
          >
            {emp.fullName}
          </button>
        </li>
      ))}
    </ul>
  );
}

function CommentComposer({
  taskId,
  employees,
  canReadEmployees,
  onDone,
  autoFocus,
  initialContent,
  initialMentionIds,
  submitLabel,
  mutationFn,
}: {
  taskId: string;
  employees: EmployeeOption[];
  canReadEmployees: boolean;
  onDone?: () => void;
  autoFocus?: boolean;
  initialContent?: string;
  initialMentionIds?: string[];
  submitLabel: string;
  mutationFn: (content: string, mentionEmployeeIds: string[]) => Promise<TaskCommentResponseDto>;
}) {
  const { t } = useTranslation("tasks");
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(initialContent ?? "");
  const [mentions, setMentions] = useState<Map<string, string>>(
    () => new Map((initialMentionIds ?? []).map((id) => [id, id])),
  );
  const [mentionState, setMentionState] = useState<{ atIndex: number; query: string } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const suggestions = useMemo(() => {
    if (!mentionState) return [];
    const q = mentionState.query.toLowerCase();
    return employees.filter((e) => e.fullName.toLowerCase().includes(q)).slice(0, 8);
  }, [mentionState, employees]);

  const mutation = useMutation({
    mutationFn: () => mutationFn(draft.trim(), Array.from(mentions.keys())),
    onSuccess: async () => {
      setDraft("");
      setMentions(new Map());
      for (const key of taskCollabInvalidation.comments(taskId)) {
        await queryClient.invalidateQueries({ queryKey: key });
      }
      onDone?.();
    },
  });

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = e.target.value;
    setDraft(value);
    const cursor = e.target.selectionStart ?? value.length;
    setMentionState(findMentionToken(value, cursor));
  }

  function selectMention(emp: EmployeeOption) {
    if (!mentionState) return;
    const cursor = textareaRef.current?.selectionStart ?? draft.length;
    const before = draft.slice(0, mentionState.atIndex);
    const after = draft.slice(cursor);
    const inserted = `@${emp.fullName} `;
    const next = `${before}${inserted}${after}`;
    setDraft(next);
    setMentions((prev) => new Map(prev).set(emp.id, emp.fullName));
    setMentionState(null);
    requestAnimationFrame(() => {
      const pos = before.length + inserted.length;
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(pos, pos);
    });
  }

  function removeMention(id: string) {
    setMentions((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <textarea
          ref={textareaRef}
          autoFocus={autoFocus}
          rows={2}
          value={draft}
          disabled={mutation.isPending}
          onChange={handleChange}
          placeholder={t("tasks.detail.comments.placeholder")}
          className="flex w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        {mentionState && canReadEmployees && (
          <Popover
            open
            onOpenChange={(open) => {
              if (!open) setMentionState(null);
            }}
            trigger={<span />}
            align="start"
            className="w-64"
          >
            <MentionSuggestions suggestions={suggestions} onSelect={selectMention} />
          </Popover>
        )}
      </div>
      {mentions.size > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {Array.from(mentions.entries()).map(([id, name]) => (
            <Badge key={id} variant="secondary" className="flex items-center gap-1">
              @{name}
              <button
                type="button"
                aria-label={t("tasks.detail.comments.mention.remove", { name })}
                onClick={() => removeMention(id)}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          disabled={mutation.isPending || draft.trim().length === 0}
          onClick={() => mutation.mutate()}
        >
          <Send className="mr-2 h-4 w-4" />
          {submitLabel}
        </Button>
        {onDone && (
          <Button type="button" size="sm" variant="outline" onClick={onDone}>
            {t("tasks.detail.comments.cancel")}
          </Button>
        )}
      </div>
      {mutation.isError && (
        <p role="alert" className="text-xs text-destructive">
          {t(commentErrorKey(mutation.error))}
        </p>
      )}
    </div>
  );
}

function DeleteCommentConfirm({
  taskId,
  comment,
  onClose,
}: {
  taskId: string;
  comment: TaskCommentResponseDto;
  onClose: () => void;
}) {
  const { t } = useTranslation("tasks");
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => taskCollabApi.deleteComment(taskId, comment.id),
    onSuccess: async () => {
      for (const key of taskCollabInvalidation.comments(taskId)) {
        await queryClient.invalidateQueries({ queryKey: key });
      }
      onClose();
    },
  });
  const noop = () => {};

  return (
    <Dialog
      open
      onClose={mutation.isPending ? noop : onClose}
      title={t("tasks.detail.comments.deleteDialog.title")}
      description={t("tasks.detail.comments.deleteDialog.description")}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            {t("tasks.detail.comments.deleteDialog.cancel")}
          </Button>
          <Button
            variant="destructive"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
          >
            {t("tasks.detail.comments.deleteDialog.confirm")}
          </Button>
        </>
      }
    >
      {mutation.isError && (
        <p role="alert" className="text-sm text-destructive">
          {t(commentErrorKey(mutation.error))}
        </p>
      )}
    </Dialog>
  );
}

function CommentRow({
  taskId,
  comment,
  isOwn,
  canComment,
  highlighted,
  onEdit,
}: {
  taskId: string;
  comment: TaskCommentResponseDto;
  isOwn: boolean;
  canComment: boolean;
  highlighted: boolean;
  onEdit: () => void;
}) {
  const { t } = useTranslation("tasks");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const rowRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    if (highlighted) rowRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [highlighted]);

  return (
    <li
      ref={rowRef}
      id={`comment-${comment.id}`}
      className={`rounded-md border p-2 text-sm ${
        highlighted ? "border-brand bg-brand/5" : "border-border"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-medium text-foreground">{comment.userName ?? "—"}</p>
          <p className="whitespace-pre-wrap text-foreground">{comment.content}</p>
          {comment.mentions.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {comment.mentions.map((m) => (
                <Badge key={m.employeeId} variant="muted">
                  @{m.name ?? m.employeeId}
                </Badge>
              ))}
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            {new Date(comment.createdAt).toLocaleString("vi-VN")}
            {comment.updatedAt && ` · ${t("tasks.detail.comments.edited")}`}
          </p>
        </div>
        {isOwn && canComment && (
          <div className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={t("tasks.detail.comments.editAction")}
              onClick={onEdit}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={t("tasks.detail.comments.deleteAction")}
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2 className="h-3.5 w-3.5 text-destructive" />
            </Button>
          </div>
        )}
      </div>
      {deleteOpen && (
        <DeleteCommentConfirm
          taskId={taskId}
          comment={comment}
          onClose={() => setDeleteOpen(false)}
        />
      )}
    </li>
  );
}

export function TaskCommentThread({ taskId }: { taskId: string }) {
  const { t } = useTranslation("tasks");
  const myUserId = useAuthStore((s) => s.user?.id);
  const canComment = useCan(
    TASK_CORE_ENGINE_PAIRS.COMMENT.action,
    TASK_CORE_ENGINE_PAIRS.COMMENT.resourceType,
  );
  const canReadEmployees = useCan("read", "employee");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [highlightId] = useState<string | null>(() =>
    typeof window === "undefined"
      ? null
      : new URLSearchParams(window.location.search).get("comment_id"),
  );

  const {
    data: comments,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: taskKeys.comments(taskId),
    queryFn: () => taskCollabApi.listComments(taskId),
    staleTime: 30_000,
  });

  const { data: employeesPage } = useQuery({
    queryKey: hrKeys.employees.list({ pageSize: 100, status: "active" }),
    queryFn: () => hrApi.listEmployees({ pageSize: 100, status: "active" }),
    enabled: canComment && canReadEmployees,
    staleTime: 60_000,
  });
  // Nhân viên chưa có fullName (hồ sơ chưa đủ) KHÔNG mention được (không có gì để hiển thị/khớp autocomplete).
  const employees: EmployeeOption[] = (employeesPage?.items ?? []).flatMap((e) =>
    e.fullName ? [{ id: e.id, fullName: e.fullName }] : [],
  );

  return (
    <Card className="space-y-3 p-4">
      <h3 className="text-sm font-semibold text-muted-foreground">
        {t("tasks.detail.comments.title")}
      </h3>

      {isLoading ? (
        <div className="h-16 animate-pulse rounded bg-muted" />
      ) : isError ? (
        <div className="space-y-2">
          <p className="text-sm text-destructive">{t("tasks.detail.comments.errors.loadFailed")}</p>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            {t("actions.retry", { ns: "common" })}
          </Button>
        </div>
      ) : comments && comments.length > 0 ? (
        <ul className="space-y-2">
          {comments.map((c) =>
            editingId === c.id ? (
              <li key={c.id} className="rounded-md border border-border p-2">
                <CommentComposer
                  taskId={taskId}
                  employees={employees}
                  canReadEmployees={canReadEmployees}
                  autoFocus
                  initialContent={c.content}
                  initialMentionIds={c.mentions.map((m) => m.employeeId)}
                  submitLabel={t("tasks.detail.comments.saveEdit")}
                  onDone={() => setEditingId(null)}
                  mutationFn={(content, mentionEmployeeIds) =>
                    taskCollabApi.updateComment(taskId, c.id, { content, mentionEmployeeIds })
                  }
                />
              </li>
            ) : (
              <CommentRow
                key={c.id}
                taskId={taskId}
                comment={c}
                isOwn={c.userId === myUserId}
                canComment={canComment}
                highlighted={highlightId === c.id}
                onEdit={() => setEditingId(c.id)}
              />
            ),
          )}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{t("tasks.detail.comments.empty")}</p>
      )}

      {canComment && editingId === null && (
        <CommentComposer
          taskId={taskId}
          employees={employees}
          canReadEmployees={canReadEmployees}
          submitLabel={t("tasks.detail.comments.send")}
          mutationFn={(content, mentionEmployeeIds) =>
            taskCollabApi.addComment(taskId, { content, mentionEmployeeIds })
          }
        />
      )}
    </Card>
  );
}
