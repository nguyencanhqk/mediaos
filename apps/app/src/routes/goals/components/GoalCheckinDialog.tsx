import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError, goalApi, goalInvalidation } from "@mediaos/web-core";
import type { CheckinGoalRequest, GoalCoreResponseDto } from "@mediaos/contracts";
import { Button, Checkbox, Dialog, Input } from "@mediaos/ui";
import { CHECKIN_CONFIDENCE_MAX, CHECKIN_CONFIDENCE_MIN, PROGRESS_PERCENT_MAX } from "../constants";

/**
 * S5-GOAL-FE-2 — hộp thoại check-in tiến độ (GOAL-SCREEN-005 · GOAL-API-007).
 *
 * MỘT Ô SỐ DUY NHẤT, KHÔNG BAO GIỜ HAI. `currentValue` và `progressPercent` là hai cách gọi CÙNG một
 * cột (`current_value`) tuỳ `measure_type`; gửi cả hai ⇒ 422 GOAL-ERR-006 ở service. Vì vậy form chỉ
 * dựng ĐÚNG một ô theo `measureType`:
 *   · `percent` → ô % (gửi `progressPercent`);
 *   · `number`  → ô giá trị thực kèm đơn vị + nhắc mục tiêu (gửi `currentValue`);
 *   · `boolean` → toggle đạt/chưa (gửi `currentValue` 1/0).
 * Bỏ trống ô số là HỢP LỆ (SPEC-10 §13.1): check-in "chỉ ghi cảm nhận + ghi chú" — với mục tiêu đo theo
 * task/dự án/mục tiêu con thì đó là hình thức check-in DUY NHẤT có nghĩa (số do hệ thống tính).
 *
 * KHÓA Ở CLIENT trước khi chạm API: goal đã chốt kỳ (GOAL-ERR-005) hoặc status ≠ Active
 * (GOAL-ERR-006) ⇒ nút submit disabled + nêu lý do, thay vì để người dùng ăn 422 khó hiểu.
 * Lỗi từ server hiện VERBATIM `err.message` (mã GOAL-ERR-XXX BE đã viết cho người đọc) và hộp thoại
 * KHÔNG tự đóng — đóng là mất luôn nội dung vừa gõ.
 *
 * `goal_updates` là sổ APPEND-ONLY: ở đây chỉ GHI THÊM, không có đường sửa/xoá dòng lịch sử.
 */
export function GoalCheckinDialog({
  goal,
  onClose,
}: {
  goal: GoalCoreResponseDto;
  onClose: () => void;
}) {
  const { t } = useTranslation("goals");
  const queryClient = useQueryClient();

  const [numericDraft, setNumericDraft] = useState("");
  const [achieved, setAchieved] = useState((goal.currentValue ?? 0) > 0);
  const [confidence, setConfidence] = useState("");
  const [note, setNote] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const finalized = Boolean(goal.finalizedAt);
  const notActive = goal.status !== "Active";
  const locked = finalized || notActive;
  // Mode đo tự động: số đến từ engine (task/dự án/mục tiêu con) ⇒ KHÔNG cho gõ số bằng tay,
  // check-in chỉ còn ý nghĩa "ghi cảm nhận + ghi chú".
  const manualMeasure = goal.progressMode === "manual";

  const mutation = useMutation({
    mutationFn: (body: CheckinGoalRequest) => goalApi.checkIn(goal.id, body),
    onSuccess: async () => {
      await Promise.all(
        goalInvalidation
          .checkin(goal.id)
          .map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      );
      onClose();
    },
  });

  /** Chuỗi rỗng → undefined (không gửi field); chuỗi không phải số → null (lỗi nhập). */
  function parseOptionalNumber(raw: string): number | undefined | null {
    const trimmed = raw.trim();
    if (trimmed === "") return undefined;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function handleSubmit() {
    setLocalError(null);

    const confidenceValue = parseOptionalNumber(confidence);
    if (confidenceValue === null) return setLocalError(t("checkinDialog.errors.valueInvalid"));
    if (
      confidenceValue !== undefined &&
      (confidenceValue < CHECKIN_CONFIDENCE_MIN || confidenceValue > CHECKIN_CONFIDENCE_MAX)
    ) {
      return setLocalError(t("checkinDialog.errors.confidenceRange"));
    }

    const body: CheckinGoalRequest = {};
    if (confidenceValue !== undefined) body.confidence = Math.round(confidenceValue);
    if (note.trim() !== "") body.note = note.trim();

    if (manualMeasure) {
      if (goal.measureType === "boolean") {
        body.currentValue = achieved ? 1 : 0;
      } else {
        const numeric = parseOptionalNumber(numericDraft);
        if (numeric === null) return setLocalError(t("checkinDialog.errors.valueInvalid"));
        if (numeric !== undefined) {
          if (goal.measureType === "percent") {
            if (numeric < 0 || numeric > PROGRESS_PERCENT_MAX) {
              return setLocalError(t("checkinDialog.errors.progressRange"));
            }
            // CHỈ progressPercent — không kèm currentValue (GOAL-ERR-006).
            body.progressPercent = numeric;
          } else {
            body.currentValue = numeric;
          }
        }
      }
    }

    mutation.mutate(body);
  }

  const serverError =
    mutation.error instanceof ApiError && mutation.error.message
      ? mutation.error.message
      : mutation.isError
        ? t("checkinDialog.errors.generic")
        : null;

  return (
    <Dialog
      open
      onClose={onClose}
      title={t("checkinDialog.title")}
      description={t("checkinDialog.description")}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            {t("actions.cancel", { ns: "common" })}
          </Button>
          <Button
            size="sm"
            data-testid="goal-checkin-submit"
            disabled={locked || mutation.isPending}
            onClick={handleSubmit}
          >
            {mutation.isPending ? t("checkinDialog.submitting") : t("checkinDialog.submit")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-sm font-medium text-foreground">
          {goal.goalCode} — {goal.name}
        </p>

        {locked && (
          <p className="rounded-md border border-warning/40 bg-warning-muted px-3 py-2 text-sm text-warning">
            {finalized ? t("checkinDialog.locked.finalized") : t("checkinDialog.locked.notActive")}
          </p>
        )}

        {!manualMeasure ? (
          <p className="text-xs text-muted-foreground">{t("checkinDialog.hints.autoMeasured")}</p>
        ) : goal.measureType === "boolean" ? (
          <label className="flex items-center gap-2 text-sm text-foreground">
            <Checkbox
              data-testid="goal-checkin-boolean"
              checked={achieved}
              disabled={locked}
              onChange={(e) => setAchieved(e.target.checked)}
            />
            {t("checkinDialog.fields.achieved")}
          </label>
        ) : goal.measureType === "percent" ? (
          <FieldBlock
            id="goal-checkin-progress"
            label={t("checkinDialog.fields.progressPercent")}
            hint={t("checkinDialog.hints.valueOptional")}
          >
            <Input
              id="goal-checkin-progress"
              data-testid="goal-checkin-progress"
              type="number"
              min={0}
              max={PROGRESS_PERCENT_MAX}
              value={numericDraft}
              disabled={locked}
              onChange={(e) => setNumericDraft(e.target.value)}
            />
          </FieldBlock>
        ) : (
          <FieldBlock
            id="goal-checkin-current"
            label={`${t("checkinDialog.fields.currentValue")}${goal.unit ? ` (${goal.unit})` : ""}`}
            hint={
              goal.targetValue === null
                ? t("checkinDialog.hints.noTarget")
                : t("checkinDialog.hints.target", { target: goal.targetValue })
            }
          >
            <Input
              id="goal-checkin-current"
              data-testid="goal-checkin-current"
              type="number"
              value={numericDraft}
              disabled={locked}
              onChange={(e) => setNumericDraft(e.target.value)}
            />
          </FieldBlock>
        )}

        <FieldBlock id="goal-checkin-confidence" label={t("checkinDialog.fields.confidence")}>
          <Input
            id="goal-checkin-confidence"
            data-testid="goal-checkin-confidence"
            type="number"
            min={CHECKIN_CONFIDENCE_MIN}
            max={CHECKIN_CONFIDENCE_MAX}
            value={confidence}
            disabled={locked}
            onChange={(e) => setConfidence(e.target.value)}
          />
        </FieldBlock>

        <FieldBlock id="goal-checkin-note" label={t("checkinDialog.fields.note")}>
          <textarea
            id="goal-checkin-note"
            data-testid="goal-checkin-note"
            rows={3}
            value={note}
            disabled={locked}
            placeholder={t("checkinDialog.placeholders.note")}
            onChange={(e) => setNote(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          />
        </FieldBlock>

        {(localError ?? serverError) && (
          <p className="text-sm text-destructive" role="alert">
            {localError ?? serverError}
          </p>
        )}
      </div>
    </Dialog>
  );
}

function FieldBlock({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
