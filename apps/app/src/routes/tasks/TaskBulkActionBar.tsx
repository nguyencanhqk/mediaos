import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Loader2, X } from "lucide-react";
import { companyTimeZone, formatDateTime } from "@mediaos/web-core";
import { Button, Popover, toast } from "@mediaos/ui";
import type { TaskCoreResponseDto } from "@mediaos/contracts";
import { TASK_CORE_STATUS_OPTIONS } from "./constants";
import { DeadlineQuickPicker } from "./DeadlineQuickPicker";
import { EmployeePicker } from "./EmployeePicker";
import {
  TASK_BULK_MAX,
  useTaskBulkAction,
  useTaskBulkPermissions,
  type TaskBulkAction,
  type TaskBulkOutcome,
} from "./hooks/use-task-bulk-action";

/**
 * Thanh hành động nổi khi có việc được chọn (S20-TASK-BULKACTIONS-1 · US-TASK-QL-03).
 *
 * Luồng: chọn hành động + giá trị ⇒ dòng xác nhận («Giao 6 việc cho B») ⇒ «Xác nhận» chạy từng việc qua
 * route action chuyên trách. Quá {@link TASK_BULK_MAX} việc ⇒ «Xác nhận» khoá kèm lời giải thích. Kết
 * quả báo theo từng dòng: dòng lỗi VẪN được chọn (thử lại được) và chỉ ghi «Không thực hiện được».
 */
export interface MoveTarget {
  readonly id: string;
  readonly label: string;
}

interface TaskBulkActionBarProps {
  readonly selectedTasks: readonly TaskCoreResponseDto[];
  /** Sau lệnh: chỉ giữ chọn các id lỗi. */
  readonly onRetainFailed: (failedIds: readonly string[]) => void;
  readonly onClear: () => void;
  /** Cột pipeline của dự án — có ⇒ hiện «Chuyển cột» (nếu có quyền). */
  readonly moveTargets?: readonly MoveTarget[];
}

function ChoiceMenu({
  id,
  label,
  items,
  onPick,
}: {
  id: string;
  label: string;
  items: readonly { readonly key: string; readonly label: string }[];
  onPick: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="start"
      className="w-56 p-1"
      trigger={
        <Button
          variant="outline"
          size="sm"
          data-testid={id}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {label}
        </Button>
      }
    >
      <div role="menu" aria-label={label}>
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            role="menuitem"
            data-testid={`${id}-${item.key}`}
            className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
            onClick={() => {
              setOpen(false);
              onPick(item.key);
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
    </Popover>
  );
}

function describePending(
  t: TFunction<"tasks">,
  action: TaskBulkAction,
  count: number,
  moveTargets: readonly MoveTarget[],
): string {
  switch (action.kind) {
    case "assign":
      return t("bulk.confirm.assign", {
        count,
        name: action.employeeName ?? t("assigneeWarning.fallbackName"),
      });
    case "deadline":
      return t("bulk.confirm.deadline", {
        count,
        when: action.dueAt ? formatDateTime(action.dueAt, companyTimeZone()) : "",
      });
    case "status":
      return t("bulk.confirm.status", { count, status: t(`tasks.status.${action.status}`) });
    case "moveState":
      return t("bulk.confirm.moveState", {
        count,
        name: moveTargets.find((target) => target.id === action.stateId)?.label ?? "",
      });
  }
}

/** Cảnh báo gộp THÀNH MỘT câu cho cả lệnh («3 việc: B đang nghỉ phép»); `null` khi không có gì. */
function aggregateWarning(
  t: TFunction<"tasks">,
  action: TaskBulkAction,
  outcome: TaskBulkOutcome,
): string | null {
  const { onLeave, notMember } = outcome.warningCounts;
  const name =
    action.kind === "assign" ? (action.employeeName ?? t("assigneeWarning.fallbackName")) : null;
  const parts: string[] = [];
  if (onLeave > 0) {
    parts.push(
      name
        ? t("bulk.warnings.onLeaveNamed", { count: onLeave, name })
        : t("bulk.warnings.onLeave", { count: onLeave }),
    );
  }
  if (notMember > 0) parts.push(t("bulk.warnings.notMember", { count: notMember }));
  return parts.length > 0 ? parts.join(" · ") : null;
}

function notifyOutcome(
  t: TFunction<"tasks">,
  action: TaskBulkAction,
  outcome: TaskBulkOutcome,
): void {
  const ok = outcome.succeeded.length;
  if (outcome.failedIds.length === 0) {
    toast.success(t("bulk.result.allOk", { count: ok }), { key: "task-bulk-result" });
  } else if (ok === 0) {
    toast.error(t("bulk.result.allFailed", { total: outcome.total }), { key: "task-bulk-result" });
  } else {
    toast.warning(t("bulk.result.partial", { ok, total: outcome.total }), {
      key: "task-bulk-result",
    });
  }
  const warning = aggregateWarning(t, action, outcome);
  if (warning) toast.warning(warning, { key: "task-bulk-warning" });
}

export function TaskBulkActionBar({
  selectedTasks,
  onRetainFailed,
  onClear,
  moveTargets = [],
}: TaskBulkActionBarProps) {
  const { t } = useTranslation("tasks");
  const perms = useTaskBulkPermissions();
  const { run, isRunning } = useTaskBulkAction();
  const [pending, setPending] = useState<TaskBulkAction | null>(null);
  const [failedIds, setFailedIds] = useState<readonly string[]>([]);

  const count = selectedTasks.length;
  const canMove = perms.canMoveState && moveTargets.length > 0;
  const hasAnyAction = perms.canAssign || perms.canDeadline || perms.canStatus || canMove;
  if (count === 0 || !hasAnyAction) return null;

  const overLimit = count > TASK_BULK_MAX;
  const failedRows = selectedTasks.filter((task) => failedIds.includes(task.id));

  const confirm = async () => {
    if (!pending || overLimit || isRunning) return;
    const action = pending;
    const outcome = await run(
      selectedTasks.map((task) => task.id),
      action,
    );
    setPending(null);
    setFailedIds(outcome.failedIds);
    notifyOutcome(t, action, outcome);
    onRetainFailed(outcome.failedIds);
  };

  const clear = () => {
    setPending(null);
    setFailedIds([]);
    onClear();
  };

  return (
    <div
      role="region"
      aria-label={t("bulk.barLabel")}
      data-testid="task-bulk-bar"
      className="sticky bottom-4 z-20 space-y-2 rounded-xl border border-border bg-card p-3 shadow-lg"
    >
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-medium" data-testid="task-bulk-count">
          {t("bulk.selected", { count })}
        </span>
        {pending ? (
          <>
            <span className="text-sm" data-testid="task-bulk-pending">
              {describePending(t, pending, count, moveTargets)}
            </span>
            <Button
              size="sm"
              data-testid="task-bulk-confirm"
              disabled={overLimit || isRunning}
              aria-describedby={overLimit ? "task-bulk-limit" : undefined}
              onClick={() => void confirm()}
            >
              {isRunning && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
              {t("bulk.confirmButton")}
            </Button>
            <Button variant="ghost" size="sm" disabled={isRunning} onClick={() => setPending(null)}>
              {t("bulk.cancel")}
            </Button>
          </>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {perms.canAssign && (
              <EmployeePicker
                employeeId={null}
                name={null}
                avatarUrl={null}
                canEdit
                showName
                testId="bulk-assign"
                emptyLabel={t("bulk.actions.assign")}
                onSelect={(employeeId, employee) => {
                  if (!employeeId) return;
                  setPending({
                    kind: "assign",
                    employeeId,
                    employeeName: employee?.fullName ?? null,
                  });
                }}
              />
            )}
            {perms.canDeadline && (
              <span className="inline-flex items-center gap-1.5 text-sm">
                {t("bulk.actions.deadline")}
                <DeadlineQuickPicker
                  id="bulk-deadline"
                  value={null}
                  allowClear={false}
                  variant="quick"
                  ariaLabel={t("bulk.actions.deadline")}
                  onSelect={(dueAt) => setPending({ kind: "deadline", dueAt })}
                />
              </span>
            )}
            {perms.canStatus && (
              <ChoiceMenu
                id="bulk-status"
                label={t("bulk.actions.status")}
                items={TASK_CORE_STATUS_OPTIONS.map((status) => ({
                  key: status,
                  label: t(`tasks.status.${status}`),
                }))}
                onPick={(key) => {
                  const status = TASK_CORE_STATUS_OPTIONS.find((option) => option === key);
                  if (status) setPending({ kind: "status", status });
                }}
              />
            )}
            {canMove && (
              <ChoiceMenu
                id="bulk-move-state"
                label={t("bulk.actions.moveState")}
                items={moveTargets.map((target) => ({ key: target.id, label: target.label }))}
                onPick={(stateId) => setPending({ kind: "moveState", stateId })}
              />
            )}
          </div>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto"
          aria-label={t("bulk.clear")}
          data-testid="task-bulk-clear"
          disabled={isRunning}
          onClick={clear}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
      {overLimit && pending && (
        <p id="task-bulk-limit" className="text-xs text-destructive" data-testid="task-bulk-limit">
          {t("bulk.overLimit", { max: TASK_BULK_MAX, count })}
        </p>
      )}
      {failedRows.length > 0 && (
        <ul className="space-y-0.5 text-xs" data-testid="task-bulk-failed">
          {failedRows.map((task) => (
            <li key={task.id} className="flex gap-2">
              <span className="truncate">{task.title}</span>
              <span className="shrink-0 text-destructive">{t("bulk.result.rowFailed")}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
