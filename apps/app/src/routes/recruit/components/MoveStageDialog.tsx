import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { recruitApi, recruitKeys } from "@mediaos/web-core";
import type { CandidateListItemResponseDto, CandidateStageDto } from "@mediaos/contracts";
import { RECRUIT_MOVE_REASON_MIN } from "@mediaos/contracts";
import { Button, Dialog, Select } from "@mediaos/ui";
import { availableStageMoveTargets } from "../recruit-actions";
import { parseRecruitError, recruitErrorI18nKey } from "../recruit-errors";

interface MoveStageDialogProps {
  open: boolean;
  onClose: () => void;
  candidate: Pick<CandidateListItemResponseDto, "id" | "stage" | "fullName"> | null;
  onDone: () => void;
}

/**
 * REC-SCREEN-002 (S12-RECRUIT-FE-1) — chuyển giai đoạn ứng viên. Đích luôn suy từ
 * `availableStageMoveTargets` (FSM thuần, KHÔNG bao giờ liệt kê `Hired` — chỉ đạt qua convert ở tab
 * Offer). Hộp lý do BẮT BUỘC ≥ `RECRUIT_MOVE_REASON_MIN` ký tự (contracts — cùng nguồn Zod server).
 */
export function MoveStageDialog({ open, onClose, candidate, onDone }: MoveStageDialogProps) {
  const { t } = useTranslation("recruit");
  const queryClient = useQueryClient();

  const [toStage, setToStage] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setToStage("");
    setReason("");
    setError(null);
  }, [open, candidate?.id]);

  const targets = candidate ? availableStageMoveTargets(candidate.stage as CandidateStageDto) : [];

  const mutation = useMutation({
    mutationFn: () =>
      recruitApi.moveCandidateStage(candidate!.id, {
        toStage: toStage as CandidateStageDto,
        reason: reason.trim(),
      }),
    onSuccess: () => {
      // `candidates.allOf()` prefix-cover luôn `candidates.summary()` (cùng gốc key) — invalidate riêng
      // là dư (mục 17 review-gate).
      void queryClient.invalidateQueries({ queryKey: recruitKeys.candidates.allOf() });
      onDone();
      onClose();
    },
    onError: (err) => {
      const info = parseRecruitError(err);
      setError(t(recruitErrorI18nKey(info), { ...Object.fromEntries(info.fields) }));
    },
  });

  const canSubmit =
    toStage !== "" && reason.trim().length >= RECRUIT_MOVE_REASON_MIN && !mutation.isPending;

  return (
    <Dialog
      open={open && candidate !== null}
      onClose={onClose}
      title={t("pipeline.moveDialogTitle")}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t("states.cancel")}
          </Button>
          <Button disabled={!canSubmit} onClick={() => mutation.mutate()}>
            {mutation.isPending ? t("states.saving") : t("pipeline.submitMove")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{candidate?.fullName}</p>

        {targets.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("pipeline.noTargets")}</p>
        ) : (
          <>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">{t("pipeline.targetStage")}</span>
              <Select value={toStage} onChange={(e) => setToStage(e.target.value)}>
                <option value="">—</option>
                {targets.map((s) => (
                  <option key={s} value={s}>
                    {t(`stage.${s}`)}
                  </option>
                ))}
              </Select>
            </label>

            <label className="block text-sm">
              <span className="mb-1 block font-medium">{t("pipeline.reasonLabel")}</span>
              <textarea
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="flex w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <span className="mt-1 block text-xs text-muted-foreground">
                {t("pipeline.reasonHint")}
              </span>
            </label>
          </>
        )}

        {error && (
          <p
            role="alert"
            className="rounded-md border border-danger/40 bg-danger-muted px-3 py-2 text-sm text-danger"
          >
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
