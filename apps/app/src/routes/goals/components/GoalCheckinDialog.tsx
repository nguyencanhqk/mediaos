import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError, goalApi, goalInvalidation } from "@mediaos/web-core";
import type { CheckinGoalRequest, GoalCoreResponseDto } from "@mediaos/contracts";
import { Button, Checkbox, Dialog, Input, toast } from "@mediaos/ui";
import {
  GOAL_CONFIDENCE_LEVELS,
  PROGRESS_PERCENT_MAX,
  type GoalConfidenceLevel,
} from "../constants";
import { formatProgress } from "../goal-format";
import { ConfidencePicker, FieldBlock, LastCheckinHint } from "./GoalCheckinDialogParts";

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
 * S20-GOAL-QUICKCHECKIN-1 (US-GOAL-NV-03) — check-in nhanh:
 *   · ô số ĐIỀN SẴN `goal.currentValue` — đúng cột mà ô đó ghi (với `percent`, ô «Tiến độ (%)» cũng
 *     ghi `current_value`; điền `progressPercent` vào đó rồi gửi nguyên là ghi sai số khi chỉ tiêu ≠ 100);
 *   · con trỏ ở ô số khi mở; Ctrl/Cmd+Enter ở bất kỳ đâu trong hộp ⇒ gửi;
 *   · độ tự tin 3 nút, MẶC ĐỊNH KHÔNG CHỌN ⇒ body không có `confidence` (mức lần trước chỉ là chú thích);
 *   · thành công ⇒ toast kèm % mới server trả về (đã recompute).
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
  const valueInputRef = useRef<HTMLInputElement>(null);

  const [numericDraft, setNumericDraft] = useState(() =>
    goal.currentValue === null ? "" : String(goal.currentValue),
  );
  const [achieved, setAchieved] = useState((goal.currentValue ?? 0) > 0);
  const [confidence, setConfidence] = useState<GoalConfidenceLevel | null>(null);
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
    onSuccess: async (updated) => {
      toast.success(
        t("checkinDialog.toastSuccess", {
          name: goal.name,
          percent: formatProgress(updated.progressPercent),
        }),
      );
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
    if (locked || mutation.isPending) return;
    setLocalError(null);

    const body: CheckinGoalRequest = {};
    // Không chọn ⇒ KHÔNG gửi — không tự mang mức tự tin cũ vào sổ chỉ-thêm.
    if (confidence) body.confidence = GOAL_CONFIDENCE_LEVELS[confidence];
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

  // Ctrl/Cmd+Enter ⇒ gửi, dù con trỏ đang ở ô số, ghi chú hay nút độ tự tin. Tham chiếu MỚI NHẤT qua
  // ref để listener không phải đăng ký lại mỗi lần gõ (cùng kỹ thuật phím Esc của `Dialog`).
  const submitRef = useRef(handleSubmit);
  useLayoutEffect(() => {
    submitRef.current = handleSubmit;
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || !(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      submitRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Con trỏ vào ô số (bôi đen sẵn để gõ đè). Effect của cha chạy SAU effect focus-phần-tử-đầu của
  // `Dialog` (con) ⇒ thắng; không có ô số (boolean / đo tự động) ⇒ giữ focus mặc định của Dialog.
  useEffect(() => {
    valueInputRef.current?.focus();
    valueInputRef.current?.select();
  }, []);

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
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">
            {goal.goalCode} — {goal.name}
          </p>
          <LastCheckinHint goal={goal} />
        </div>

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
              ref={valueInputRef}
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
              ref={valueInputRef}
              id="goal-checkin-current"
              data-testid="goal-checkin-current"
              type="number"
              value={numericDraft}
              disabled={locked}
              onChange={(e) => setNumericDraft(e.target.value)}
            />
          </FieldBlock>
        )}

        <ConfidencePicker value={confidence} onChange={setConfidence} disabled={locked} />

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

        {!locked && (
          <p className="text-xs text-muted-foreground">{t("checkinDialog.hints.shortcut")}</p>
        )}

        {(localError ?? serverError) && (
          <p className="text-sm text-destructive" role="alert">
            {localError ?? serverError}
          </p>
        )}
      </div>
    </Dialog>
  );
}
