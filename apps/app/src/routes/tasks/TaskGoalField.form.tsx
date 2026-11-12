import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Dialog, Select } from "@mediaos/ui";
import type { GoalCoreResponseDto, TaskCoreResponseDto } from "@mediaos/contracts";
import type { GoalSuggestContext } from "@/routes/goals/goal-suggest";
import { useGoalSuggestions } from "@/routes/goals/use-goal-suggestions";
import { useGoalSuggestLink } from "@/routes/goals/use-goal-suggestions-link";

/**
 * S20-GOAL-SUGGEST-1 (US-GOAL-NV-92) — ô «Mục tiêu» của form TẠO việc.
 *   · đúng 1 ứng viên là mục tiêu cá nhân của CHÍNH người tạo ⇒ chọn sẵn kèm nhãn «Gợi ý»;
 *   · đúng 1 ứng viên khác ⇒ chip một chạm (chưa gắn tới khi bấm);
 *   · nhiều ứng viên ⇒ dropdown, KHÔNG chọn sẵn;
 *   · thiếu update:goal / update:task / không ứng viên ⇒ không có ô, không gọi GET /goals.
 * Lựa chọn tính lại khi người phụ trách / dự án / phòng / hạn đổi (ứng viên đổi ⇒ lựa chọn không còn hợp
 * lệ tự rơi về «không gắn»). Ô chỉ BÁO lựa chọn lên form (`onChange`); bước gắn do `useCreateGoalLink`.
 */
export function TaskFormGoalField({
  ctx,
  onChange,
}: {
  ctx: GoalSuggestContext;
  onChange: (goal: GoalCoreResponseDto | null) => void;
}) {
  const { t } = useTranslation("tasks");
  const { enabled, candidates, mode, myEmployeeId } = useGoalSuggestions(ctx);
  const [touched, setTouched] = useState(false);
  const [pickedId, setPickedId] = useState<string | null>(null);

  const wantedId = touched ? pickedId : mode === "preselect" ? (candidates[0]?.id ?? null) : null;
  const selected = candidates.find((g) => g.id === wantedId) ?? null;

  const reported = useRef<string | null>(null);
  useEffect(() => {
    if ((selected?.id ?? null) === reported.current) return;
    reported.current = selected?.id ?? null;
    onChange(selected);
  }, [selected, onChange]);

  if (!enabled || mode === "none") return null;
  const choose = (id: string | null) => {
    setTouched(true);
    setPickedId(id);
  };
  const nameOf = (g: GoalCoreResponseDto) => `${g.goalCode} — ${g.name}`;

  if (mode === "chip") {
    const only = candidates[0];
    if (!only) return null;
    return (
      <div className="space-y-1.5" data-testid="task-form-goal">
        <p className="text-sm font-medium text-foreground">{t("goalSuggest.label")}</p>
        {selected ? (
          <p className="flex items-center gap-2 text-sm">
            <span data-testid="task-form-goal-on">
              {t("goalSuggest.chipOn", { goal: nameOf(only) })}
            </span>
            <button
              type="button"
              className="text-xs text-muted-foreground underline"
              onClick={() => choose(null)}
            >
              {t("goalSuggest.chipRemove")}
            </button>
          </p>
        ) : (
          <button
            type="button"
            data-testid="task-form-goal-chip"
            onClick={() => choose(only.id)}
            className="rounded-full border border-border px-2.5 py-0.5 text-xs text-foreground hover:bg-muted"
          >
            {t("goalSuggest.chipOffer", { goal: nameOf(only) })}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-1.5" data-testid="task-form-goal">
      <label htmlFor="task-goal" className="text-sm font-medium text-foreground">
        {t("goalSuggest.label")}
        {selected && !touched && myEmployeeId && (
          <span
            data-testid="task-form-goal-badge"
            className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground"
          >
            {t("goalSuggest.badge")}
          </span>
        )}
      </label>
      <Select
        id="task-goal"
        value={selected?.id ?? ""}
        onChange={(e) => choose(e.target.value === "" ? null : e.target.value)}
      >
        <option value="">{t("goalSuggest.none")}</option>
        {candidates.map((g) => (
          <option key={g.id} value={g.id}>
            {nameOf(g)}
          </option>
        ))}
      </Select>
    </div>
  );
}

export interface PendingGoalLink {
  readonly task: TaskCoreResponseDto;
  readonly goal: GoalCoreResponseDto;
  readonly reason: string;
}

/**
 * Bước 2 của «tạo rồi gắn»: `attempt(task)` trả true khi KHÔNG có gì để gắn hoặc gắn xong; false khi server
 * từ chối ⇒ `pending` mang việc đã tạo + lý do (phía form hiện `TaskCreatedUnlinkedDialog`, không báo
 * thành công giả, không để người dùng bấm Lưu lần nữa — sẽ tạo trùng).
 */
export function useCreateGoalLink() {
  const { link, describeFailure } = useGoalSuggestLink();
  const selectedRef = useRef<GoalCoreResponseDto | null>(null);
  const [pending, setPending] = useState<PendingGoalLink | null>(null);

  const setSelected = useCallback((goal: GoalCoreResponseDto | null) => {
    selectedRef.current = goal;
  }, []);

  const run = useCallback(
    async (task: TaskCoreResponseDto, goal: GoalCoreResponseDto): Promise<boolean> => {
      try {
        await link({
          goalId: goal.id,
          goalCode: goal.goalCode,
          taskId: task.id,
          projectId: task.projectId,
        });
        setPending(null);
        return true;
      } catch (err) {
        setPending({ task, goal, reason: describeFailure(err) });
        return false;
      }
    },
    [link, describeFailure],
  );

  const attempt = useCallback(
    async (task: TaskCoreResponseDto): Promise<boolean> => {
      const goal = selectedRef.current;
      return goal ? run(task, goal) : true;
    },
    [run],
  );

  const retry = useCallback(async (): Promise<boolean> => {
    return pending ? run(pending.task, pending.goal) : true;
  }, [pending, run]);

  return { setSelected, pending, attempt, retry };
}

export function TaskCreatedUnlinkedDialog({
  pending,
  onRetry,
  onClose,
}: {
  pending: PendingGoalLink;
  onRetry: () => Promise<boolean>;
  onClose: () => void;
}) {
  const { t } = useTranslation("tasks");
  const { t: tg } = useTranslation("goals");
  const [busy, setBusy] = useState(false);
  const code = pending.task.title;
  return (
    <Dialog
      open
      onClose={onClose}
      title={t("goalSuggest.createdTitle", { code })}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            {t("goalSuggest.close")}
          </Button>
          <Button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const ok = await onRetry();
              setBusy(false);
              if (ok) onClose();
            }}
          >
            {tg("goalSuggest.retry")}
          </Button>
        </>
      }
    >
      <p role="alert" data-testid="task-created-unlinked" className="text-sm text-destructive">
        {tg("goalSuggest.unlinkedAfterCreate", { code, reason: pending.reason })}
      </p>
    </Dialog>
  );
}
