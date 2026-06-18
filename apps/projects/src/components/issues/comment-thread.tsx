import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { MessageSquare } from "lucide-react";
import { Avatar, Button } from "@mediaos/ui";
import { useCan } from "@mediaos/web-core";
import { tasksApi } from "@/lib/tasks-api";
import { queryKeys } from "@/lib/query-keys";

interface CommentThreadProps {
  taskId: string;
}

/**
 * Luồng bình luận của 1 work item (mirror pattern studio): list + ô thêm. Read gated read:task (server),
 * write gated comment:comment (ẩn ô nhập nếu thiếu quyền). Hiển thị tên người nếu server trả userFullName,
 * không thì id rút gọn (không bịa).
 */
export function CommentThread({ taskId }: CommentThreadProps) {
  const { t } = useTranslation("projects");
  const qc = useQueryClient();
  const canComment = useCan("comment", "comment");
  const [body, setBody] = useState("");

  const comments = useQuery({
    queryKey: queryKeys.comments(taskId),
    queryFn: () => tasksApi.getComments(taskId),
  });

  const add = useMutation({
    mutationFn: () => tasksApi.addComment(taskId, { body: body.trim() }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.comments(taskId) });
      setBody("");
    },
  });

  return (
    <section className="space-y-3">
      <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <MessageSquare className="h-3.5 w-3.5" />
        {t("detail.comments")}
        {comments.data && comments.data.length > 0 && (
          <span className="rounded-full bg-muted px-1.5 text-[10px] font-medium text-muted-foreground">
            {comments.data.length}
          </span>
        )}
      </h3>

      {comments.isLoading ? (
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      ) : comments.isError ? (
        <p className="text-sm text-destructive">{t("detail.commentsError")}</p>
      ) : comments.data && comments.data.length > 0 ? (
        <ul className="space-y-3">
          {comments.data.map((c) => (
            <li key={c.id} className="flex gap-2.5">
              <Avatar name={c.userFullName ?? c.userId} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-medium text-foreground">
                    {c.userFullName ?? c.userId.slice(0, 8).toUpperCase()}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {new Date(c.createdAt).toLocaleString("vi-VN")}
                  </span>
                </div>
                <p className="whitespace-pre-wrap break-words text-sm text-foreground/90">
                  {c.body}
                </p>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{t("detail.noComments")}</p>
      )}

      {canComment && (
        <div className="space-y-2">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={2}
            placeholder={t("detail.commentPlaceholder")}
            className="flex w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div className="flex justify-end">
            <Button
              size="sm"
              onClick={() => add.mutate()}
              disabled={!body.trim() || add.isPending}
            >
              {add.isPending ? t("detail.commentSubmitting") : t("detail.commentSubmit")}
            </Button>
          </div>
          {add.isError && <p className="text-sm text-destructive">{t("detail.commentError")}</p>}
        </div>
      )}
    </section>
  );
}
