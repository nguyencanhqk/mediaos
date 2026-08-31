import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { recruitApi, recruitKeys } from "@mediaos/web-core";
import type { InterviewStatusDto } from "@mediaos/contracts";
import { Button, Dialog, Input, Select } from "@mediaos/ui";
import { availableInterviewStatusTargets } from "../recruit-actions";
import { parseRecruitError, recruitErrorI18nKey } from "../recruit-errors";

/** REC-SCREEN-005/003 — đổi trạng thái lượt phỏng vấn (Completed/Cancelled, FSM §13.4). */
export function ChangeInterviewStatusDialog({
  interviewId,
  currentStatus,
  onClose,
  onDone,
}: {
  interviewId: string | null;
  currentStatus: InterviewStatusDto;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation("recruit");
  const queryClient = useQueryClient();
  const [toStatus, setToStatus] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const targets = availableInterviewStatusTargets(currentStatus);

  useEffect(() => {
    setToStatus("");
    setNote("");
    setError(null);
  }, [interviewId]);

  const mutation = useMutation({
    mutationFn: () =>
      recruitApi.changeInterviewStatus(interviewId!, {
        toStatus: toStatus as "Completed" | "Cancelled",
        note: note.trim() === "" ? null : note.trim(),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: recruitKeys.interviews.allOf() });
      onDone();
      onClose();
    },
    onError: (err) => {
      const info = parseRecruitError(err);
      setError(t(recruitErrorI18nKey(info), { ...Object.fromEntries(info.fields) }));
    },
  });

  return (
    <Dialog
      open={interviewId !== null}
      onClose={onClose}
      title={t("interviews.statusDialogTitle")}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t("states.cancel")}
          </Button>
          <Button
            disabled={toStatus === "" || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {t("interviews.changeStatus")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Select value={toStatus} onChange={(e) => setToStatus(e.target.value)}>
          <option value="">—</option>
          {targets.map((s) => (
            <option key={s} value={s}>
              {t(`interviewStatus.${s}`)}
            </option>
          ))}
        </Select>
        <Input
          placeholder={t("interviews.statusNote")}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
