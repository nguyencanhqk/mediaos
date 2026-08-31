import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { recruitApi, recruitKeys, useCan } from "@mediaos/web-core";
import type { InterviewRecommendationDto } from "@mediaos/contracts";
import { RECRUIT_FEEDBACK_RATING_MAX, RECRUIT_FEEDBACK_RATING_MIN } from "@mediaos/contracts";
import { Button, Select, Skeleton } from "@mediaos/ui";
import { RECRUIT_ENGINE_PAIRS } from "../constants";
import { parseRecruitError, recruitErrorI18nKey } from "../recruit-errors";

const RECOMMENDATION_OPTIONS: readonly InterviewRecommendationDto[] = [
  "Hire",
  "No Hire",
  "Consider",
];
const RATING_OPTIONS = Array.from(
  { length: RECRUIT_FEEDBACK_RATING_MAX - RECRUIT_FEEDBACK_RATING_MIN + 1 },
  (_, i) => RECRUIT_FEEDBACK_RATING_MIN + i,
);

/**
 * REC-SCREEN-005/003 — bảng đánh giá per-interviewer + form đánh giá CỦA MÌNH. BE tự ép "Own" (chỉ ghi
 * được feedback nếu là participant, `feedback:interview` — NOT_PARTICIPANT/FEEDBACK_DUPLICATE 409/403)
 * nên FE cứ hiện form khi có quyền `feedback:interview`, không tự đoán "mình có phải participant không".
 */
export function InterviewFeedbackPanel({ interviewId }: { interviewId: string }) {
  const { t } = useTranslation("recruit");
  const queryClient = useQueryClient();
  const canFeedback = useCan(
    RECRUIT_ENGINE_PAIRS.interviewFeedbackCreate.action,
    RECRUIT_ENGINE_PAIRS.interviewFeedbackCreate.resourceType,
  );

  const detailQuery = useQuery({
    queryKey: recruitKeys.interviews.detail(interviewId),
    queryFn: () => recruitApi.getInterview(interviewId),
  });

  const [rating, setRating] = useState(String(RECRUIT_FEEDBACK_RATING_MAX));
  const [recommendation, setRecommendation] = useState<InterviewRecommendationDto>("Consider");
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    setError(null);
    setEditing(false);
  }, [interviewId]);

  const mutation = useMutation({
    // Thử TẠO trước; nếu BE báo `feedback-duplicate` (đã ghi lần trước) thì tự chuyển sang SỬA — FE
    // không có cách nào biết "mình" ứng với `interviewerEmployeeId` nào mà không thêm một round-trip
    // tra cứu, nên để BE là trọng tài (route feedback tự ép Own theo participant).
    mutationFn: async () => {
      const body = {
        rating: Number(rating),
        recommendation,
        comment: comment.trim() === "" ? null : comment.trim(),
      };
      try {
        return await recruitApi.createInterviewFeedback(interviewId, body);
      } catch (err) {
        const info = parseRecruitError(err);
        if (info.kind === "feedback-duplicate") {
          return recruitApi.updateInterviewFeedback(interviewId, body);
        }
        throw err;
      }
    },
    onSuccess: () => {
      setError(null);
      setEditing(false);
      void queryClient.invalidateQueries({ queryKey: recruitKeys.interviews.detail(interviewId) });
    },
    onError: (err) => {
      const info = parseRecruitError(err);
      setError(t(recruitErrorI18nKey(info), { ...Object.fromEntries(info.fields) }));
    },
  });

  if (detailQuery.isLoading) return <Skeleton className="h-20 w-full" />;
  const feedbacks = detailQuery.data?.feedbacks ?? [];

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">{t("interviews.feedbackTitle")}</p>
      {feedbacks.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("interviews.feedbackEmpty")}</p>
      ) : (
        <ul className="space-y-1">
          {feedbacks.map((f) => (
            <li key={f.id} className="rounded-md border border-border p-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium">
                  {f.rating}/{RECRUIT_FEEDBACK_RATING_MAX} ·{" "}
                  {t(`recommendation.${f.recommendation}`)}
                </span>
              </div>
              {f.comment && <p className="mt-1 text-xs text-muted-foreground">{f.comment}</p>}
            </li>
          ))}
        </ul>
      )}

      {canFeedback && !editing && (
        <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
          {t("interviews.addFeedback")}
        </Button>
      )}

      {canFeedback && editing && (
        <div className="space-y-2 rounded-md border border-border p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block text-xs">
              <span className="mb-1 block font-medium">{t("interviews.rating")}</span>
              <Select value={rating} onChange={(e) => setRating(e.target.value)}>
                {RATING_OPTIONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </Select>
            </label>
            <label className="block text-xs">
              <span className="mb-1 block font-medium">{t("interviews.recommendationLabel")}</span>
              <Select
                value={recommendation}
                onChange={(e) => setRecommendation(e.target.value as InterviewRecommendationDto)}
              >
                {RECOMMENDATION_OPTIONS.map((r) => (
                  <option key={r} value={r}>
                    {t(`recommendation.${r}`)}
                  </option>
                ))}
              </Select>
            </label>
          </div>
          <textarea
            rows={2}
            placeholder={t("interviews.comment")}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            className="flex w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          {error && <p className="text-xs text-danger">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              {t("states.cancel")}
            </Button>
            <Button size="sm" disabled={mutation.isPending} onClick={() => mutation.mutate()}>
              {t("interviews.submitFeedback")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
