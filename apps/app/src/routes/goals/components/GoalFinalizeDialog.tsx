import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError, goalApi, goalInvalidation } from "@mediaos/web-core";
import type { GoalCoreResponseDto } from "@mediaos/contracts";
import { Button, Dialog } from "@mediaos/ui";

/**
 * S5-GOAL-FE-2 — hộp thoại XÁC NHẬN chốt kỳ / mở lại (GOAL-API-009).
 *
 * MỘT component cho HAI hành động vì chúng dùng CHUNG một cặp quyền `('finalize','goal')` (SPEC-10 §11
 * không định nghĩa cặp riêng cho reopen, migration 0506 chỉ seed 7 cặp — bịa `reopen:goal` ở FE là dựng
 * gate cho một cặp KHÔNG TỒN TẠI). Chỉ đổi nhãn + endpoint theo `mode`.
 *
 * VÌ SAO PHẢI XÁC NHẬN: chốt kỳ đóng băng số liệu và khoá MỌI đường ghi (sửa/check-in/gắn-tháo việc,
 * GOAL-ERR-005) — hệ quả phải hiện thành chữ TRƯỚC khi gọi API, không phải sau khi người dùng phát
 * hiện mình không sửa được nữa. Mutation CHỈ chạy khi bấm nút xác nhận trong hộp thoại này.
 */
export function GoalFinalizeDialog({
  goal,
  mode,
  onClose,
}: {
  goal: GoalCoreResponseDto;
  mode: "finalize" | "reopen";
  onClose: () => void;
}) {
  const { t } = useTranslation("goals");
  const queryClient = useQueryClient();
  const [note, setNote] = useState("");

  const ns = mode === "finalize" ? "finalizeDialog" : "reopenDialog";

  const mutation = useMutation({
    mutationFn: () => {
      const body = note.trim() === "" ? {} : { note: note.trim() };
      return mode === "finalize" ? goalApi.finalize(goal.id, body) : goalApi.reopen(goal.id, body);
    },
    onSuccess: async () => {
      await Promise.all(
        goalInvalidation
          .finalize(goal.id)
          .map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      );
      onClose();
    },
  });

  const errorMessage =
    mutation.error instanceof ApiError && mutation.error.message
      ? mutation.error.message
      : mutation.isError
        ? t(`${ns}.error`)
        : null;

  return (
    <Dialog
      open
      onClose={onClose}
      title={t(`${ns}.title`)}
      description={t(`${ns}.description`)}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            {t("actions.cancel", { ns: "common" })}
          </Button>
          <Button
            size="sm"
            variant={mode === "finalize" ? "default" : "outline"}
            data-testid="goal-finalize-submit"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? t(`${ns}.submitting`) : t(`${ns}.submit`)}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-sm font-medium text-foreground">
          {goal.goalCode} — {goal.name}
        </p>
        <div className="space-y-1.5">
          <label htmlFor="goal-finalize-note" className="text-xs font-medium text-muted-foreground">
            {t(`${ns}.noteLabel`)}
          </label>
          <textarea
            id="goal-finalize-note"
            data-testid="goal-finalize-note"
            rows={3}
            value={note}
            placeholder={t(`${ns}.notePlaceholder`)}
            onChange={(e) => setNote(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
          />
        </div>
        {errorMessage && (
          <p className="text-sm text-destructive" role="alert">
            {errorMessage}
          </p>
        )}
      </div>
    </Dialog>
  );
}
