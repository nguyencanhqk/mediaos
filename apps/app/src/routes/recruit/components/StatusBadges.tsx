import { useTranslation } from "react-i18next";
import { Badge } from "@mediaos/ui";
import type {
  CandidateStageDto,
  JobOpeningStatusDto,
  InterviewStatusDto,
  OfferStatusDto,
} from "@mediaos/contracts";
import {
  RECRUIT_STAGE_BADGE_VARIANT,
  RECRUIT_JOB_STATUS_BADGE_VARIANT,
  RECRUIT_INTERVIEW_STATUS_BADGE_VARIANT,
  RECRUIT_OFFER_STATUS_BADGE_VARIANT,
} from "../constants";

/**
 * S12-RECRUIT-FE-1 — nhãn trạng thái dùng CHUNG cho mọi màn RECRUIT (khuôn `AssetStatusBadge`). Khoá
 * i18n tra THẲNG bằng giá trị server — namespace `recruit` giữ nguyên chuỗi có khoảng trắng.
 */
export function CandidateStageBadge({ stage }: { stage: CandidateStageDto }) {
  const { t } = useTranslation("recruit");
  return <Badge variant={RECRUIT_STAGE_BADGE_VARIANT[stage]}>{t(`stage.${stage}`)}</Badge>;
}

export function JobOpeningStatusBadge({ status }: { status: JobOpeningStatusDto }) {
  const { t } = useTranslation("recruit");
  return (
    <Badge variant={RECRUIT_JOB_STATUS_BADGE_VARIANT[status]}>{t(`jobStatus.${status}`)}</Badge>
  );
}

export function InterviewStatusBadge({ status }: { status: InterviewStatusDto }) {
  const { t } = useTranslation("recruit");
  return (
    <Badge variant={RECRUIT_INTERVIEW_STATUS_BADGE_VARIANT[status]}>
      {t(`interviewStatus.${status}`)}
    </Badge>
  );
}

export function OfferStatusBadge({ status }: { status: OfferStatusDto }) {
  const { t } = useTranslation("recruit");
  return (
    <Badge variant={RECRUIT_OFFER_STATUS_BADGE_VARIANT[status]}>{t(`offerStatus.${status}`)}</Badge>
  );
}
