import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Pencil } from "lucide-react";
import { recruitApi, recruitKeys, useCanExact } from "@mediaos/web-core";
import {
  Button,
  EmptyState,
  PageHeader,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@mediaos/ui";
import { RECRUIT_ENGINE_PAIRS } from "./constants";
import { CandidateStageBadge } from "./components/StatusBadges";
import { CandidateInterviewsTab } from "./components/CandidateInterviewsTab";
import { CandidateNotesTab } from "./components/CandidateNotesTab";
import { OfferTab } from "./components/OfferTab";
import { CandidateCvTab } from "./components/CandidateCvTab";

interface CandidateDetailPageProps {
  candidateId: string;
  onBack: () => void;
  onEdit: (id: string) => void;
}

/**
 * REC-SCREEN-003 (+ 006 offer/convert là tab) — chi tiết ứng viên. 6 tab: Hồ sơ ‖ Lịch sử ‖ Phỏng vấn ‖
 * Ghi chú ‖ Offer & chuyển NV ‖ CV. `view`/`update`:`candidate` là SENSITIVE ⇒ `useCanExact`.
 *
 * `email`/`phone` hiển thị NGUYÊN giá trị server trả — đã mask sẵn (chuỗi kiểu "d***@***.vn") khi caller
 * thiếu `update:candidate` (`piiMasked=true`); FE KHÔNG tự che thêm, KHÔNG tự "giải mã" — render thẳng.
 */
export function CandidateDetailPage({ candidateId, onBack, onEdit }: CandidateDetailPageProps) {
  const { t } = useTranslation("recruit");
  const [tab, setTab] = useState("profile");

  const canView = useCanExact(
    RECRUIT_ENGINE_PAIRS.candidateDetail.action,
    RECRUIT_ENGINE_PAIRS.candidateDetail.resourceType,
  );
  const canUpdate = useCanExact(
    RECRUIT_ENGINE_PAIRS.candidateUpdate.action,
    RECRUIT_ENGINE_PAIRS.candidateUpdate.resourceType,
  );
  const canViewTimeline = useCanExact(
    RECRUIT_ENGINE_PAIRS.candidateStageEvents.action,
    RECRUIT_ENGINE_PAIRS.candidateStageEvents.resourceType,
  );

  const detailQuery = useQuery({
    queryKey: recruitKeys.candidates.detail(candidateId),
    queryFn: () => recruitApi.getCandidate(candidateId),
    enabled: canView,
  });

  const timelineQuery = useQuery({
    queryKey: recruitKeys.candidates.stageEvents(candidateId, { page: 1 }),
    queryFn: () => recruitApi.listStageEvents(candidateId, { page: 1 }),
    enabled: canViewTimeline && tab === "timeline",
  });

  if (!canView) {
    return (
      <EmptyState
        title={t("states.error")}
        action={<Button onClick={onBack}>{t("detail.back")}</Button>}
      />
    );
  }
  if (detailQuery.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  const candidate = detailQuery.data;
  if (detailQuery.isError || !candidate) {
    return (
      <EmptyState
        title={t("detail.notFound")}
        action={<Button onClick={onBack}>{t("detail.back")}</Button>}
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={candidate.fullName}
        description={candidate.source ?? undefined}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" size="sm" onClick={onBack}>
              <ArrowLeft className="mr-2 size-4" />
              {t("detail.back")}
            </Button>
            {canUpdate && (
              <Button variant="outline" size="sm" onClick={() => onEdit(candidateId)}>
                <Pencil className="mr-2 size-4" />
                {t("detail.edit")}
              </Button>
            )}
          </div>
        }
      />

      <CandidateStageBadge stage={candidate.stage} />
      {candidate.piiMasked && (
        <p className="text-xs text-muted-foreground">{t("detail.piiMaskedNote")}</p>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="profile">{t("detail.tabs.profile")}</TabsTrigger>
          <TabsTrigger value="timeline">{t("detail.tabs.timeline")}</TabsTrigger>
          <TabsTrigger value="interviews">{t("detail.tabs.interviews")}</TabsTrigger>
          <TabsTrigger value="notes">{t("detail.tabs.notes")}</TabsTrigger>
          <TabsTrigger value="offers">{t("detail.tabs.offers")}</TabsTrigger>
          <TabsTrigger value="cv">{t("detail.tabs.cv")}</TabsTrigger>
        </TabsList>

        <TabsContent value="profile">
          <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
            <Field label={t("detail.fields.fullName")} value={candidate.fullName} />
            <Field label={t("detail.fields.email")} value={candidate.email} />
            <Field label={t("detail.fields.phone")} value={candidate.phone} />
            <Field label={t("detail.fields.source")} value={candidate.source} />
            <Field label={t("detail.fields.note")} value={candidate.note} />
          </dl>
        </TabsContent>

        <TabsContent value="timeline">
          {!canViewTimeline ? (
            <p className="text-sm text-muted-foreground">{t("states.error")}</p>
          ) : timelineQuery.isLoading ? (
            <Skeleton className="h-20 w-full" />
          ) : (timelineQuery.data?.data ?? []).length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">{t("timeline.empty")}</p>
          ) : (
            <ul className="divide-y divide-border">
              {(timelineQuery.data?.data ?? []).map((ev) => (
                <li key={ev.id} className="py-2 text-sm">
                  <p className="font-medium">
                    {t("timeline.entry", {
                      from: t(`stage.${ev.fromStage}`),
                      to: t(`stage.${ev.toStage}`),
                    })}
                    {" · "}
                    {ev.action === "convert"
                      ? t("timeline.actionConvert")
                      : t("timeline.actionMove")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("timeline.reason")}: {ev.reason} ·{" "}
                    {ev.actedAt.slice(0, 16).replace("T", " ")}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="interviews">
          <CandidateInterviewsTab candidateId={candidateId} candidateName={candidate.fullName} />
        </TabsContent>

        <TabsContent value="notes">
          <CandidateNotesTab candidateId={candidateId} />
        </TabsContent>

        <TabsContent value="offers">
          <OfferTab
            candidateId={candidateId}
            candidateStage={candidate.stage}
            candidateEmployeeId={candidate.employeeId}
            onConverted={() => void detailQuery.refetch()}
          />
        </TabsContent>

        <TabsContent value="cv">
          <CandidateCvTab candidateId={candidateId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{value ?? "—"}</dd>
    </div>
  );
}
