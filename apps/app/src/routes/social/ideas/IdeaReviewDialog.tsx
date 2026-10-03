/**
 * S16-SOCIAL-FE-2 — hộp thoại xét duyệt sáng kiến (SOCIAL-API-046, plan D8 + §8 L14).
 *
 * Chỉ đưa ĐÍCH hợp lệ theo FSM (`ideaReviewTargets`); `rejected` bắt buộc lý do (đo sau trim). Ghi
 * chú rỗng ⇒ BỎ khoá `reviewNote` (không gửi `""`). Mỗi lượt xét duyệt GHI ĐÈ ghi chú cũ (D21 của
 * BE) — hộp thoại nói ra điều đó khi sáng kiến đã có ghi chú.
 *
 * Người mở hộp thoại đã qua `PermissionGate approve:feed-idea` ở màn 008; server vẫn là cổng cuối
 * (403 `SOCIAL-ERR-020` — `useCan` bỏ qua scope, BE đòi sàn Company; seed chỉ cấp Company).
 *
 * S16-SOCIAL-FEBLOCKSEED-1 — đổi dòng H5 của plan FE-2 §8 (viết khi thẻ chưa có pill): thẻ bài giờ vẽ
 * pill từ `post.idea` trong cache DANH SÁCH/CHI TIẾT bài ⇒ xét duyệt (thành công, hoặc lỗi — 409 ERR-019
 * = người khác vừa đổi trạng thái) invalidate CẢ các cache đó, không chỉ `ideas.allOf()`. Thiếu ⇒ quay
 * lại `/feed` trong `staleTime` 30s thấy pill cũ. Trên màn 008 chúng không có observer ⇒ chỉ bị đánh dấu,
 * 0 request thừa. (Nợ: `search` · `profilePosts` — cùng khe hở với `invalidatePostLists`.)
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button, Dialog } from "@mediaos/ui";
import { ApiError, socialApi, socialKeys } from "@mediaos/web-core";
import {
  FEED_NOTE_MAX,
  type FeedIdeaItemDto,
  type FeedIdeaReviewTargetDto,
  type ReviewFeedIdeaDto,
} from "@mediaos/contracts";
import { ActionErrorBanner } from "../feed/components/ActionErrorBanner";
import { ideaReviewTargets, isReviewNoteRequired, isReviewSubmittable } from "./lib/idea-review";

interface IdeaReviewDialogProps {
  idea: FeedIdeaItemDto;
  onClose: () => void;
}

export function IdeaReviewDialog({ idea, onClose }: IdeaReviewDialogProps): React.ReactElement {
  const { t } = useTranslation("social");
  const queryClient = useQueryClient();
  const targets = ideaReviewTargets(idea.status);
  const [target, setTarget] = React.useState<FeedIdeaReviewTargetDto | null>(
    targets.length === 1 ? (targets[0] ?? null) : null,
  );
  const [note, setNote] = React.useState("");
  const [error, setError] = React.useState<{ forbidden: boolean } | null>(null);

  /** Màn 008 + mọi cache mà pill trên thẻ bài đọc (docblock đầu file). */
  const invalidateIdeaViews = (): void => {
    void queryClient.invalidateQueries({ queryKey: socialKeys.ideas.allOf() });
    void queryClient.invalidateQueries({ queryKey: socialKeys.feed.allOf() });
    void queryClient.invalidateQueries({ queryKey: socialKeys.saved() });
    void queryClient.invalidateQueries({ queryKey: socialKeys.posts.detail(idea.postId) });
  };

  const mutation = useMutation({
    mutationFn: (body: ReviewFeedIdeaDto) => socialApi.reviewIdea(idea.postId, body),
    onSuccess: () => {
      invalidateIdeaViews();
      onClose();
    },
    onError: (err: unknown) => {
      setError({ forbidden: err instanceof ApiError && err.status === 403 });
      // 409 ERR-019 = người khác vừa duyệt trước ⇒ tải lại để thấy trạng thái thật.
      invalidateIdeaViews();
    },
  });

  const trimmed = note.trim();
  const tooLong = trimmed.length > FEED_NOTE_MAX;
  const canSubmit = isReviewSubmittable(target, note) && !tooLong && !mutation.isPending;

  const submit = (): void => {
    if (!canSubmit || target === null) return;
    mutation.mutate({ status: target, ...(trimmed.length > 0 ? { reviewNote: trimmed } : {}) });
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={t("idea.reviewTitle")}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose}>
            {t("idea.cancel")}
          </Button>
          <Button
            type="button"
            data-testid="idea-review-submit"
            disabled={!canSubmit}
            onClick={submit}
          >
            {mutation.isPending ? t("idea.submitting") : t("idea.submit")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3" data-testid="idea-review-dialog">
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium text-foreground">
            {t("idea.targetLabel")}
          </legend>
          {targets.map((value) => (
            <label key={value} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name={`idea-review-${idea.ideaId}`}
                data-testid={`idea-review-target-${value}`}
                checked={target === value}
                onChange={() => setTarget(value)}
              />
              {t(`idea.status.${value}`)}
            </label>
          ))}
        </fieldset>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-foreground">{t("idea.note")}</span>
          <textarea
            data-testid="idea-review-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("idea.notePlaceholder")}
            rows={3}
            className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>

        {idea.reviewNote !== null && (
          <p className="text-xs text-muted-foreground" data-testid="idea-review-replaces">
            {t("idea.noteReplaces")}
          </p>
        )}
        {target !== null && isReviewNoteRequired(target) && trimmed.length === 0 && (
          <p
            role="alert"
            data-testid="idea-review-note-required"
            className="text-sm text-destructive"
          >
            {t("idea.noteRequired")}
          </p>
        )}
        {tooLong && (
          <p role="alert" className="text-sm text-destructive">
            {t("idea.noteTooLong", { max: FEED_NOTE_MAX })}
          </p>
        )}
        {error && (
          <ActionErrorBanner
            kind="ideaReview"
            forbidden={error.forbidden}
            onDismiss={() => setError(null)}
          />
        )}
      </div>
    </Dialog>
  );
}
