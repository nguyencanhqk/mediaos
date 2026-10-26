import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CirclePlay } from "lucide-react";
import type { GoalCoreResponseDto } from "@mediaos/contracts";
import { Button, Checkbox, Dialog, toast } from "@mediaos/ui";
import { goalStatusErrorMessage, useGoalStatusMutation } from "../hooks/use-goal-status-mutation";
import {
  bulkActivateToast,
  draftGoalIds,
  runGoalBulkActivate,
  type GoalBulkActivateResult,
} from "../goal-bulk-activate";

interface BulkReportRow {
  readonly goalId: string;
  readonly code: string;
  readonly name: string;
  readonly reason: string;
}

interface BulkReport {
  readonly rejected: readonly BulkReportRow[];
  readonly unprocessedCount: number;
}

function toReport(
  result: GoalBulkActivateResult,
  rowsById: ReadonlyMap<string, GoalCoreResponseDto>,
  reasonOf: (error: unknown) => string,
): BulkReport | null {
  if (result.rejected.length === 0 && result.unprocessed.length === 0) return null;
  return {
    rejected: result.rejected.map(({ goalId, error }) => ({
      goalId,
      code: rowsById.get(goalId)?.goalCode ?? goalId,
      name: rowsById.get(goalId)?.name ?? "",
      reason: reasonOf(error),
    })),
    unprocessedCount: result.unprocessed.length,
  };
}

export interface GoalBulkActivateBarProps {
  /** Các dòng ĐANG được chọn trên danh sách hiện tại (có thể lẫn trạng thái). */
  readonly selectedRows: readonly GoalCoreResponseDto[];
  readonly onClearSelection: () => void;
  /** Lô xong: các id còn giữ chọn (dòng chưa xử lý — để thử lại). */
  readonly onFinished: (keepSelectedIds: readonly string[]) => void;
}

/**
 * S20-GOAL-BULKACTIVATE-1 (US-GOAL-QL-11) — thanh «Kích hoạt (n)» trên /goals. Trang chỉ dựng thanh khi
 * người xem có cặp `update:goal` (useCan); server vẫn ép phạm vi + validate + audit từng PATCH.
 *
 * Chọn lẫn trạng thái ⇒ nút chỉ đếm và chỉ gửi mục Draft. Xác nhận trước khi gửi. Mỗi mục một lần đổi
 * qua hook chung (lạc quan, dòng bị từ chối về Nháp) với `notify: false` — thanh tự tổng kết bằng MỘT
 * toast + bảng báo theo dòng (bị từ chối kèm lý do · số dòng chưa xử lý).
 *
 * Dựng ở CẤP TRANG, NGOÀI bảng: `Dialog` không portal — click trong hộp không được nổi bọt lên dòng.
 */
export function GoalBulkActivateBar({
  selectedRows,
  onClearSelection,
  onFinished,
}: GoalBulkActivateBarProps) {
  const { t } = useTranslation("goals");
  const { settleStatus } = useGoalStatusMutation({ notify: false });
  const [confirming, setConfirming] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [report, setReport] = useState<BulkReport | null>(null);

  const draftIds = draftGoalIds(selectedRows);
  const running = progress !== null;
  if (selectedRows.length === 0 && !running && !report) return null;

  const run = async () => {
    setConfirming(false);
    if (draftIds.length === 0) return;
    const ids = draftIds;
    const rowsById = new Map(selectedRows.map((row) => [row.id, row]));
    setReport(null);
    setProgress({ done: 0, total: ids.length });
    const result = await runGoalBulkActivate(
      ids,
      (goalId) => settleStatus({ goalId, status: "Active" }),
      { onProgress: (done) => setProgress({ done, total: ids.length }) },
    );
    setProgress(null);
    const reasonOf = (error: unknown) => goalStatusErrorMessage(error, t);
    const summary = bulkActivateToast(result, reasonOf, (key, params) => t(key, params));
    toast[summary.variant](summary.message);
    setReport(toReport(result, rowsById, reasonOf));
    onFinished(result.unprocessed);
  };

  return (
    <section
      aria-label={t("bulkActivate.region")}
      data-testid="goal-bulk-bar"
      className="space-y-2 rounded-lg border border-border bg-muted/40 p-3"
    >
      {selectedRows.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm font-medium text-foreground">
            {t("bulkActivate.selected", { count: selectedRows.length })}
          </p>
          {draftIds.length < selectedRows.length && (
            <p className="text-sm text-muted-foreground">
              {t("bulkActivate.draftOnly", { count: draftIds.length })}
            </p>
          )}
          <div className="ml-auto flex flex-wrap gap-2">
            <Button variant="outline" size="sm" disabled={running} onClick={onClearSelection}>
              {t("bulkActivate.clear")}
            </Button>
            <Button
              size="sm"
              data-testid="goal-bulk-activate"
              disabled={running || draftIds.length === 0}
              onClick={() => setConfirming(true)}
            >
              <CirclePlay className="h-4 w-4" />
              {t("bulkActivate.submit", { count: draftIds.length })}
            </Button>
          </div>
        </div>
      )}

      {progress && (
        <p role="status" className="text-sm text-muted-foreground">
          {t("bulkActivate.running", progress)}
        </p>
      )}

      {report && <BulkReportPanel report={report} onDismiss={() => setReport(null)} />}

      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={t("bulkActivate.confirm.title", { count: draftIds.length })}
        description={t("bulkActivate.confirm.description")}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setConfirming(false)}>
              {t("actions.cancel", { ns: "common" })}
            </Button>
            <Button size="sm" data-testid="goal-bulk-activate-confirm" onClick={() => void run()}>
              {t("bulkActivate.submit", { count: draftIds.length })}
            </Button>
          </div>
        }
      >
        <ul className="max-h-48 space-y-1 overflow-y-auto text-sm text-foreground">
          {selectedRows
            .filter((row) => row.status === "Draft")
            .map((row) => (
              <li key={row.id}>
                {row.goalCode} — {row.name}
              </li>
            ))}
        </ul>
      </Dialog>
    </section>
  );
}

function BulkReportPanel({ report, onDismiss }: { report: BulkReport; onDismiss: () => void }) {
  const { t } = useTranslation("goals");
  return (
    <div data-testid="goal-bulk-report" className="space-y-1 rounded-md border border-border p-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-foreground">{t("bulkActivate.report.title")}</p>
        <Button variant="ghost" size="sm" onClick={onDismiss}>
          {t("bulkActivate.report.dismiss")}
        </Button>
      </div>
      {report.rejected.length > 0 && (
        <ul className="space-y-0.5 text-sm text-destructive">
          {report.rejected.map((row) => (
            <li key={row.goalId}>
              {t("bulkActivate.report.rejected", {
                code: row.code,
                name: row.name,
                reason: row.reason,
              })}
            </li>
          ))}
        </ul>
      )}
      {report.unprocessedCount > 0 && (
        <p className="text-sm text-muted-foreground">
          {t("bulkActivate.report.unprocessed", { count: report.unprocessedCount })}
        </p>
      )}
    </div>
  );
}

/** Chip «Nháp» — bộ lọc `status=Draft` trên URL (US-GOAL-QL-03); nhấn lại để bỏ lọc. */
export function GoalDraftChip({ pressed, onToggle }: { pressed: boolean; onToggle: () => void }) {
  const { t } = useTranslation("goals");
  return (
    <button
      type="button"
      data-testid="goal-list-draft-chip"
      aria-pressed={pressed}
      onClick={onToggle}
      className={
        pressed
          ? "rounded-full border border-primary bg-primary px-3 py-1.5 text-sm text-primary-foreground"
          : "rounded-full border border-border px-3 py-1.5 text-sm hover:bg-muted"
      }
    >
      {t("bulkActivate.draftChip")}
    </button>
  );
}

/**
 * Ô chọn của một dòng / của header. Chặn click nổi bọt lên `onRowClick` của dòng (mở chi tiết).
 * `indeterminate` chỉ đặt được qua DOM — gắn bằng ref.
 */
export function GoalSelectCheckbox({
  label,
  checked,
  indeterminate = false,
  onToggle,
}: {
  label: string;
  checked: boolean;
  indeterminate?: boolean;
  onToggle: () => void;
}) {
  return (
    <span className="flex items-center" onClick={(e) => e.stopPropagation()}>
      <Checkbox
        aria-label={label}
        checked={checked}
        ref={(node) => {
          if (node) node.indeterminate = indeterminate;
        }}
        onChange={onToggle}
      />
    </span>
  );
}
