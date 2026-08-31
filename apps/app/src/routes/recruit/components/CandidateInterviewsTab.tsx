import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { recruitApi, recruitKeys, useCan } from "@mediaos/web-core";
import type { InterviewResponseDto } from "@mediaos/contracts";
import { Button, Skeleton } from "@mediaos/ui";
import { RECRUIT_ENGINE_PAIRS } from "../constants";
import { InterviewFormDialog } from "./InterviewFormDialog";
import { InterviewFeedbackPanel } from "./InterviewFeedbackPanel";
import { InterviewStatusBadge } from "./StatusBadges";
import { ChangeInterviewStatusDialog } from "./ChangeInterviewStatusDialog";

/** Tab «Phỏng vấn» trong chi tiết ứng viên (REC-SCREEN-003) — danh sách lượt của MỘT ứng viên. */
export function CandidateInterviewsTab({
  candidateId,
  candidateName,
}: {
  candidateId: string;
  candidateName: string;
}) {
  const { t } = useTranslation("recruit");
  const canView = useCan(
    RECRUIT_ENGINE_PAIRS.interviewList.action,
    RECRUIT_ENGINE_PAIRS.interviewList.resourceType,
  );
  const canManage = useCan(
    RECRUIT_ENGINE_PAIRS.interviewCreate.action,
    RECRUIT_ENGINE_PAIRS.interviewCreate.resourceType,
  );

  const [createOpen, setCreateOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [statusTarget, setStatusTarget] = useState<InterviewResponseDto | null>(null);

  const listQuery = useQuery({
    queryKey: recruitKeys.interviews.list({ candidateId }),
    queryFn: () => recruitApi.listInterviews({ candidateId }),
    enabled: canView,
  });
  const interviews = listQuery.data?.data ?? [];

  if (!canView) return <p className="text-sm text-muted-foreground">{t("states.error")}</p>;

  return (
    <div className="space-y-3">
      {canManage && (
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          {t("interviews.create")}
        </Button>
      )}

      {listQuery.isLoading ? (
        <Skeleton className="h-20 w-full" />
      ) : interviews.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">{t("interviews.empty")}</p>
      ) : (
        <ul className="space-y-2">
          {interviews.map((iv) => (
            <li key={iv.id} className="rounded-md border border-border p-3 text-sm">
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  className="text-left font-medium hover:underline"
                  onClick={() => setExpandedId((prev) => (prev === iv.id ? null : iv.id))}
                >
                  {t("interviews.columns.round")} {iv.round} ·{" "}
                  {iv.startsAt.slice(0, 16).replace("T", " ")}
                </button>
                <div className="flex items-center gap-2">
                  <InterviewStatusBadge status={iv.status} />
                  {canManage && iv.status === "Scheduled" && (
                    <Button variant="outline" size="sm" onClick={() => setStatusTarget(iv)}>
                      {t("interviews.changeStatus")}
                    </Button>
                  )}
                </div>
              </div>
              {expandedId === iv.id && (
                <div className="mt-3 border-t border-border pt-3">
                  <InterviewFeedbackPanel interviewId={iv.id} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <InterviewFormDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        candidateId={candidateId}
        candidateName={candidateName}
        onDone={() => {}}
      />
      <ChangeInterviewStatusDialog
        interviewId={statusTarget?.id ?? null}
        currentStatus={statusTarget?.status ?? "Scheduled"}
        onClose={() => setStatusTarget(null)}
        onDone={() => void listQuery.refetch()}
      />
    </div>
  );
}
