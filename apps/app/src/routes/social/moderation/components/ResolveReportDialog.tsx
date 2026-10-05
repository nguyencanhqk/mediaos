/**
 * S16-SOCIAL-FE-3 (L2) — hộp thoại KẾT THÚC một báo cáo vi phạm (`SOCIAL-API-029`, màn `SOC-SCREEN-010`).
 *
 * ┌─ HỢP ĐỒNG VỚI TRANG (nơi mount) ─────────────────────────────────────────────────────────────────┐
 * │ Mount: `<ResolveReportDialog key={report.id} report={…} onClose={…} onOutcome={…} />` — chỉ mount │
 * │ khi có báo cáo đang được xử lý; `key` để nháp của báo cáo này không rò sang báo cáo khác.         │
 * │                                                                                                  │
 * │ AI SỞ HỮU GÌ                                                                                     │
 * │  · Hộp thoại sở hữu `useMutation` của 029, nháp (quyết định · hành động · tick · ghi chú) và dải  │
 * │    lỗi của các lỗi «giữ hộp thoại» (E2 · E3 · E4 · E5 · E10 · E11).                               │
 * │  · Hộp thoại KHÔNG invalidate cache nào và KHÔNG vẽ dải «kết cục». Hai việc đó là của TRANG: sau  │
 * │    refetch, hàng (và mọi thứ mount dưới nó) có thể biến mất — dải nằm ở đây sẽ mất theo (plan B6).│
 * │                                                                                                  │
 * │ HAI CALLBACK — mỗi lượt mở kết thúc bằng ĐÚNG MỘT trong hai                                       │
 * │  · `onClose()` — người dùng tự đóng (nút «Huỷ» · Esc · bấm ra ngoài). Chưa có gì được ghi; trang  │
 * │    chỉ cần unmount. KHÔNG được gọi khi đang gửi (không đóng được giữa chừng) và KHÔNG được gọi    │
 * │    kèm `onOutcome`.                                                                              │
 * │  · `onOutcome(outcome)` — 029 đã có kết cục cuối. TRANG phải: (1) unmount hộp thoại, (2) làm theo │
 * │    `outcome`:                                                                                    │
 * │      `kind: "done"`   ⇒ invalidate `socialKeys.moderation.reports.lists()`; nếu `action !== "none"`│
 * │                         thì THÊM `moderation.hiddenPosts()` · `feed.allOf()` ·                    │
 * │                         `posts.detail(report.targetSnapshot.postId)` (khi có snapshot).           │
 * │                         `action` là hành động ĐÃ GỬI (`"none"` khi body không có khoá `action`).  │
 * │                         `updated` là báo cáo server trả sau khi đổi.                              │
 * │      `kind: "failed"` ⇒ vẽ `<AdminErrorNotice reason={outcome.reason} />` ở TRANG, KHÔNG truyền   │
 * │                         `onRetry` (E1 · E6 · E9 đều là kết cục, thử lại vô ích);                  │
 * │                         `invalidate === true` (E1 · E6) ⇒ invalidate `reports.lists()`.           │
 * │    Sau `onOutcome` nút gửi tự khoá — trang chậm unmount cũng không gửi được lượt hai.             │
 * └────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Cổng: ô «Hành động kèm» ⇔ quyết định «Giải quyết» && `useCan("manage", "feed-post")` — cặp THÊM mà
 * tầng 2 của 029 đòi cho mọi hành động kèm. Người mở hộp thoại đã qua cổng `manage:feed-report` ở nút
 * «Xử lý» (`ReportRow`); server vẫn là cổng cuối (403 ⇒ E3 / E9).
 *
 * Lựa chọn, nhãn theo loại đích, luật tick và hình dạng body đều ĐỌC từ `lib/report-actions`; việc phải
 * làm sau mỗi lỗi ĐỌC từ `lib/moderation-errors` — file này không tự suy từ status/mã.
 *
 * 029 KHÔNG idempotent ở server: bấm đúp sinh 409 `SOCIAL-ERR-021` («đã có người xử lý») cho chính lượt
 * của mình ⇒ nút gửi khoá khi đang gửi (plan D20 · B23).
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import { useMutation } from "@tanstack/react-query";
import { Button, Dialog } from "@mediaos/ui";
import { socialModerationApi, useCan, type ResolveFeedReportBody } from "@mediaos/web-core";
import {
  FEED_NOTE_MAX,
  resolveFeedReportSchema,
  type FeedReportActionDto,
  type FeedReportDto,
} from "@mediaos/contracts";
import { AdminErrorNotice } from "../../admin/components/AdminErrorNotice";
import type { AdminErrorReason } from "../../admin/lib/admin-errors";
import { describeResolveReportError } from "../lib/moderation-errors";
import {
  buildResolveBody,
  NO_REPORT_ACTION,
  REPORT_DELETE_CONFIRM_KEYS,
  reportActionNeedsConfirm,
  reportActionOptions,
  type ReportDecision,
} from "../lib/report-actions";

/** Kết cục CUỐI của một lượt xử lý — xem «HỢP ĐỒNG VỚI TRANG» ở đầu file. */
export type ResolveReportOutcome =
  | {
      kind: "done";
      /** Báo cáo lúc mở hộp thoại (prop `report`). */
      report: FeedReportDto;
      /** Báo cáo server trả sau khi đổi trạng thái. */
      updated: FeedReportDto;
      /** Hành động kèm ĐÃ GỬI; `"none"` khi body không mang khoá `action`. */
      action: FeedReportActionDto;
    }
  | {
      kind: "failed";
      report: FeedReportDto;
      /** Đưa thẳng vào `<AdminErrorNotice reason>` ở trang. */
      reason: AdminErrorReason;
      /** `true` ⇒ trang invalidate `socialKeys.moderation.reports.lists()`. */
      invalidate: boolean;
    };

export interface ResolveReportDialogProps {
  /** Báo cáo ĐANG MỞ cần kết thúc. Trang mount hộp thoại với `key={report.id}`. */
  report: FeedReportDto;
  /** Người dùng tự đóng, chưa ghi gì. Không bao giờ đi kèm `onOutcome`. */
  onClose: () => void;
  /** 029 đã có kết cục cuối — trang unmount hộp thoại, invalidate và vẽ dải (nếu `failed`). */
  onOutcome: (outcome: ResolveReportOutcome) => void;
}

interface ResolveVariables {
  reportId: string;
  body: ResolveFeedReportBody;
}

/** Lỗi «giữ hộp thoại» đang hiển thị. */
interface KeptError {
  reason: AdminErrorReason;
  retryable: boolean;
}

const DECISIONS: readonly ReportDecision[] = ["resolved", "dismissed"];

const LEGEND_CLASS = "mb-1 text-sm font-medium text-foreground";
const CHOICE_CLASS = "flex items-center gap-2 text-sm text-foreground";

export function ResolveReportDialog({
  report,
  onClose,
  onOutcome,
}: ResolveReportDialogProps): React.ReactElement {
  const { t } = useTranslation("social");
  const canManagePosts = useCan("manage", "feed-post");
  const fieldId = React.useId();

  const [decision, setDecision] = React.useState<ReportDecision | null>(null);
  const [action, setAction] = React.useState<FeedReportActionDto>(NO_REPORT_ACTION);
  const [isDeleteConfirmed, setIsDeleteConfirmed] = React.useState(false);
  const [note, setNote] = React.useState("");
  const [error, setError] = React.useState<KeptError | null>(null);
  const [isTargetUnavailable, setIsTargetUnavailable] = React.useState(false);
  const [hasOutcome, setHasOutcome] = React.useState(false);

  const mutation = useMutation({
    // Mọi thứ gửi đi nằm trong `variables` — thân hàm KHÔNG đọc state (v5 nạp lại closure trong effect).
    mutationFn: ({ reportId, body }: ResolveVariables) =>
      socialModerationApi.resolveReport(reportId, body),
    onSuccess: (updated, { body }) => {
      setHasOutcome(true);
      onOutcome({ kind: "done", report, updated, action: body.action ?? NO_REPORT_ACTION });
    },
    onError: (err: unknown) => {
      const outcome = describeResolveReportError(err);
      if (outcome.dialog === "close") {
        setHasOutcome(true);
        onOutcome({
          kind: "failed",
          report,
          reason: outcome.reason,
          invalidate: outcome.invalidate,
        });
        return;
      }
      if (outcome.resetAction) {
        setAction(NO_REPORT_ACTION);
        setIsDeleteConfirmed(false);
      }
      if (outcome.reason === "reportTargetUnavailable") setIsTargetUnavailable(true);
      setError({ reason: outcome.reason, retryable: outcome.retryable });
    },
  });

  const showActions = decision === "resolved" && canManagePosts;
  const needsConfirm = showActions && reportActionNeedsConfirm(action);
  const canSubmit =
    decision !== null && (!needsConfirm || isDeleteConfirmed) && !mutation.isPending && !hasOutcome;

  // Tick xác nhận xoá chỉ có nghĩa cho ĐÚNG lựa chọn đang thấy: đổi quyết định hay đổi hành động đều bỏ tick.
  const chooseDecision = (next: ReportDecision): void => {
    setDecision(next);
    setIsDeleteConfirmed(false);
  };
  const chooseAction = (next: FeedReportActionDto): void => {
    setAction(next);
    setIsDeleteConfirmed(false);
  };

  const submit = (): void => {
    if (!canSubmit || decision === null) return;
    const body = buildResolveBody({ decision, action, note, canManagePosts });
    // Lưới cuối trước khi lên dây. Gửi `body`, KHÔNG gửi đầu ra của parse: `.default("none")` của schema
    // sẽ chèn khoá `action` vào cả lượt «Bỏ qua».
    if (!resolveFeedReportSchema.safeParse(body).success) {
      setError({ reason: "invalidRequest", retryable: false });
      return;
    }
    setError(null);
    mutation.mutate({ reportId: report.id, body });
  };

  const close = (): void => {
    if (!mutation.isPending) onClose();
  };

  const subject = t("admin.moderation.resolve.subject", {
    targetType: t(`admin.moderation.row.targetType.${report.targetType}`),
    reason: t(`admin.report.reason.${report.reason}`),
  });

  return (
    <Dialog
      open
      onClose={close}
      title={t("admin.moderation.resolve.title")}
      description={subject}
      footer={
        <>
          <Button type="button" variant="outline" disabled={mutation.isPending} onClick={close}>
            {t("admin.moderation.resolve.cancel")}
          </Button>
          <Button
            type="button"
            disabled={!canSubmit}
            aria-busy={mutation.isPending}
            onClick={submit}
          >
            {t("admin.moderation.resolve.submit")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4" data-testid="resolve-report-dialog">
        <fieldset className="flex flex-col gap-2">
          <legend className={LEGEND_CLASS}>{t("admin.moderation.resolve.decisionLabel")}</legend>
          {DECISIONS.map((value) => (
            <label key={value} className={CHOICE_CLASS}>
              <input
                type="radio"
                name={`${fieldId}-decision`}
                checked={decision === value}
                onChange={() => chooseDecision(value)}
              />
              {t(`admin.moderation.resolve.decision.${value}`)}
            </label>
          ))}
        </fieldset>

        {showActions && (
          <fieldset className="flex flex-col gap-2">
            <legend className={LEGEND_CLASS}>{t("admin.moderation.resolve.actionLabel")}</legend>
            {reportActionOptions(report.targetType).map((option) => (
              <label key={option.action} className={CHOICE_CLASS}>
                <input
                  type="radio"
                  name={`${fieldId}-action`}
                  checked={action === option.action}
                  onChange={() => chooseAction(option.action)}
                />
                {t(option.labelKey)}
              </label>
            ))}
            {isTargetUnavailable && (
              <p className="text-xs text-muted-foreground">
                {t("admin.moderation.resolve.targetUnavailableHint")}
              </p>
            )}
            {needsConfirm && (
              <label className="mt-1 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={isDeleteConfirmed}
                  onChange={(e) => setIsDeleteConfirmed(e.target.checked)}
                />
                {t(REPORT_DELETE_CONFIRM_KEYS[report.targetType])}
              </label>
            )}
          </fieldset>
        )}

        <div className="flex flex-col gap-1 text-sm">
          <label htmlFor={`${fieldId}-note`} className="font-medium text-foreground">
            {t("admin.moderation.resolve.noteLabel")}
          </label>
          <textarea
            id={`${fieldId}-note`}
            aria-describedby={`${fieldId}-note-hint`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={FEED_NOTE_MAX}
            rows={3}
            className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <p id={`${fieldId}-note-hint`} className="text-xs text-muted-foreground">
            {t("admin.moderation.resolve.noteHint", { max: FEED_NOTE_MAX })}
          </p>
        </div>

        {error && (
          <AdminErrorNotice
            reason={error.reason}
            onDismiss={() => setError(null)}
            {...(error.retryable ? { onRetry: submit } : {})}
          />
        )}
      </div>
    </Dialog>
  );
}
