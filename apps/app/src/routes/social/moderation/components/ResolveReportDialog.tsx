/**
 * S16-SOCIAL-FE-3 (L2) — hộp thoại KẾT THÚC một báo cáo vi phạm (`SOCIAL-API-029`, màn `SOC-SCREEN-010`).
 *
 * ┌─ HỢP ĐỒNG VỚI TRANG (nơi mount) ─────────────────────────────────────────────────────────────────┐
 * │ Mount: `<ResolveReportDialog key={report.id} report={…} onClose={…} onOutcome={…} onStale={…} />` │
 * │ — chỉ mount khi có báo cáo đang được xử lý; `key` để nháp của báo cáo này không rò sang báo cáo   │
 * │ khác.                                                                                            │
 * │                                                                                                  │
 * │ AI SỞ HỮU GÌ                                                                                     │
 * │  · Hộp thoại sở hữu lượt ghi 029, nháp (quyết định · hành động · tick · ghi chú) và dải lỗi của   │
 * │    các lỗi «giữ hộp thoại» (E2 · E3 · E4 · E5 · E10 · E11).                                       │
 * │  · Hộp thoại KHÔNG invalidate cache nào và KHÔNG vẽ dải «kết cục». Hai việc đó là của TRANG: sau  │
 * │    refetch, hàng (và mọi thứ mount dưới nó) có thể biến mất — dải nằm ở đây sẽ mất theo (plan B6).│
 * │                                                                                                  │
 * │ HAI CALLBACK KẾT THÚC — mỗi lượt mở kết thúc bằng ĐÚNG MỘT trong hai                              │
 * │  · `onClose()` — người dùng tự đóng (nút «Huỷ» · Esc · bấm ra ngoài). Chưa có gì được ghi; trang  │
 * │    chỉ cần unmount. KHÔNG được gọi khi đang gửi (không đóng được giữa chừng) và KHÔNG được gọi    │
 * │    kèm `onOutcome`.                                                                              │
 * │  · `onOutcome(outcome)` — 029 đã có kết cục cuối. TRANG phải: (1) unmount hộp thoại, (2) làm theo │
 * │    `outcome`:                                                                                    │
 * │      `kind: "done"`   ⇒ invalidate `socialKeys.moderation.reports.lists()`; nếu `action !== "none"`│
 * │                         thì THÊM `invalidatePostSurfaces()` (mọi bề mặt đang vẽ bài) ·            │
 * │                         `posts.detail(postId)` · `posts.comments(postId)` với `postId` =          │
 * │                         `report.targetSnapshot.postId` (khi có snapshot).                         │
 * │                         `action` là hành động ĐÃ GỬI (`"none"` khi body không có khoá `action`).  │
 * │                         `updated` là báo cáo server trả sau khi đổi.                              │
 * │      `kind: "failed"` ⇒ vẽ `<AdminErrorNotice reason={outcome.reason} />` ở TRANG, KHÔNG truyền   │
 * │                         `onRetry` (E1 · E6 · E9 đều là kết cục, thử lại vô ích);                  │
 * │                         `invalidate === true` (E1 · E6) ⇒ invalidate `reports.lists()`;           │
 * │                         `invalidatePosts === true` (E1) ⇒ THÊM đúng bộ khoá bài của nhánh `done`  │
 * │                         có hành động kèm.                                                         │
 * │    Sau `onOutcome` hộp thoại tự khoá — trang chậm unmount cũng không gửi được lượt hai và không   │
 * │    nhận thêm `onClose`.                                                                          │
 * │                                                                                                  │
 * │ MỘT CALLBACK GIỮA CHỪNG — không kết thúc lượt mở                                                  │
 * │  · `onStale()` — một lỗi GIỮ hộp thoại vừa chứng minh hàng đợi đang thấy đã cũ (E5: đích không còn│
 * │    thao tác được). TRANG invalidate `reports.lists()`; hộp thoại vẫn mở, nháp còn nguyên (hộp     │
 * │    thoại giữ bản `report` trang đã truyền, refetch không đụng tới nó).                            │
 * └────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Cổng: ô «Hành động kèm» ⇔ quyết định «Giải quyết» && `useCan("manage", "feed-post")` — cặp THÊM mà
 * tầng 2 của 029 đòi cho mọi hành động kèm. Người mở hộp thoại đã qua cổng `manage:feed-report` ở nút
 * «Xử lý» (`ReportRow`); server vẫn là cổng cuối (403 ⇒ E3 / E9).
 *
 * Lựa chọn, nhãn theo loại đích, luật tick và hình dạng body đều ĐỌC từ `lib/report-actions`; việc phải
 * làm sau mỗi lỗi ĐỌC từ `lib/moderation-errors` — file này không tự suy từ status/mã.
 *
 * 029 KHÔNG idempotent ở server: bấm đúp sinh 409 `SOCIAL-ERR-021` («đã được xử lý») cho chính lượt của
 * mình ⇒ nút gửi khoá khi đang gửi (plan D20 · B23), và lượt ghi đi qua `useGuardedMutation`: khoá đồng bộ
 * cho khoảng trước khi nút kịp khoá, hỏng ngay khi offline, hết hạn chờ thì rơi vào E11 thay vì treo.
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Dialog } from "@mediaos/ui";
import { socialModerationApi, useCan, type ResolveFeedReportBody } from "@mediaos/web-core";
import {
  FEED_NOTE_MAX,
  resolveFeedReportSchema,
  type FeedReportActionDto,
  type FeedReportDto,
} from "@mediaos/contracts";
import { AdminErrorNotice } from "../../admin/components/AdminErrorNotice";
import type { AdminErrorReason } from "../../admin/lib/admin-errors";
import { useGuardedMutation } from "../../admin/lib/use-guarded-mutation";
import { describeResolveReportError } from "../lib/moderation-errors";
import {
  buildResolveBody,
  NO_REPORT_ACTION,
  REPORT_DELETE_CONFIRM_KEYS,
  reportActionNeedsConfirm,
  reportActionOptions,
  type ReportDecision,
} from "../lib/report-actions";
import { ChoiceFieldset, DialogActions, NoteField, type KeptError } from "./dialog-fields";

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
      /** `true` ⇒ trang invalidate THÊM mọi bề mặt bài + chi tiết / bình luận của bài bị báo cáo. */
      invalidatePosts: boolean;
    };

export interface ResolveReportDialogProps {
  /** Báo cáo ĐANG MỞ cần kết thúc. Trang mount hộp thoại với `key={report.id}`. */
  report: FeedReportDto;
  /** Người dùng tự đóng, chưa ghi gì. Không bao giờ đi kèm `onOutcome`. */
  onClose: () => void;
  /** 029 đã có kết cục cuối — trang unmount hộp thoại, invalidate và vẽ dải (nếu `failed`). */
  onOutcome: (outcome: ResolveReportOutcome) => void;
  /** Hàng đợi đang thấy đã cũ nhưng hộp thoại CÒN mở — trang invalidate `reports.lists()`. */
  onStale: () => void;
}

interface ResolveVariables {
  reportId: string;
  body: ResolveFeedReportBody;
}

const DECISIONS: readonly ReportDecision[] = ["resolved", "dismissed"];

export function ResolveReportDialog({
  report,
  onClose,
  onOutcome,
  onStale,
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
  // Cờ ĐỒNG BỘ «lượt mở này ĐÃ có kết cục cuối». State `hasOutcome` tới màn sau một nhịp, nên cú đóng cùng
  // nhịp với kết cục vẫn thấy giá trị cũ và trang nhận cả `onClose` lẫn `onOutcome`. Đặt ở `finish`,
  // không bao giờ nhả. (Cờ «một lượt gửi đang bay» là của `useGuardedMutation`.)
  const hasOutcomeRef = React.useRef(false);

  const finish = (outcome: ResolveReportOutcome): void => {
    hasOutcomeRef.current = true;
    setHasOutcome(true);
    onOutcome(outcome);
  };

  const resolve = useGuardedMutation<FeedReportDto, ResolveVariables>({
    mutationFn: ({ reportId, body }, signal) =>
      socialModerationApi.resolveReport(reportId, body, signal),
    onSuccess: (updated, { body }) => {
      finish({ kind: "done", report, updated, action: body.action ?? NO_REPORT_ACTION });
    },
    onError: (err) => {
      const { dialog, reason, invalidate, invalidatePosts, resetAction, retryable } =
        describeResolveReportError(err);
      if (dialog === "close") {
        finish({ kind: "failed", report, reason, invalidate, invalidatePosts });
        return;
      }
      if (resetAction) {
        setAction(NO_REPORT_ACTION);
        setIsDeleteConfirmed(false);
      }
      if (reason === "reportTargetUnavailable") setIsTargetUnavailable(true);
      if (invalidate) onStale();
      setError({ reason, retryable });
    },
  });
  const isLocked = (): boolean => resolve.isLocked() || hasOutcomeRef.current;

  const showActions = decision === "resolved" && canManagePosts;
  const needsConfirm = showActions && reportActionNeedsConfirm(action);
  const canSubmit =
    decision !== null && (!needsConfirm || isDeleteConfirmed) && !resolve.isPending && !hasOutcome;

  // Tick xác nhận xoá chỉ có nghĩa cho ĐÚNG lựa chọn đang thấy: đổi quyết định hay đổi hành động đều bỏ tick.
  const chooseDecision = (next: ReportDecision): void => {
    setDecision(next);
    setIsDeleteConfirmed(false);
  };
  // Gợi ý sau E5 nói «hành động kèm đã được đưa về Không kèm hành động» — người dùng tự chọn lại thì câu
  // đó hết đúng ⇒ tắt.
  const chooseAction = (next: FeedReportActionDto): void => {
    setAction(next);
    setIsTargetUnavailable(false);
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
    if (hasOutcomeRef.current) return;
    if (resolve.start({ reportId: report.id, body })) setError(null);
  };

  // Hỏi CẢ cờ đồng bộ: Esc / bấm ra ngoài / «Huỷ» cùng nhịp với «Xác nhận» thấy `isPending` còn `false`,
  // lọt thì trang nhận cả `onClose` lẫn `onOutcome` cho một lượt mở. Sau một lỗi GIỮ hộp thoại (kể cả hết
  // hạn chờ) khoá đã nhả ⇒ đóng được.
  const close = (): void => {
    if (!resolve.isPending && !isLocked()) onClose();
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
        <DialogActions
          cancelLabel={t("admin.moderation.resolve.cancel")}
          submitLabel={t("admin.moderation.resolve.submit")}
          isPending={resolve.isPending}
          canSubmit={canSubmit}
          onCancel={close}
          onSubmit={submit}
        />
      }
    >
      <div className="flex flex-col gap-4" data-testid="resolve-report-dialog">
        <ChoiceFieldset
          legend={t("admin.moderation.resolve.decisionLabel")}
          name={`${fieldId}-decision`}
          options={DECISIONS.map((value) => ({
            value,
            label: t(`admin.moderation.resolve.decision.${value}`),
          }))}
          value={decision}
          onChange={chooseDecision}
        />

        {showActions && (
          <ChoiceFieldset
            legend={t("admin.moderation.resolve.actionLabel")}
            name={`${fieldId}-action`}
            options={reportActionOptions(report.targetType).map((option) => ({
              value: option.action,
              label: t(option.labelKey),
            }))}
            value={action}
            onChange={chooseAction}
          >
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
          </ChoiceFieldset>
        )}

        {/* Cảnh báo LUÔN có: `resolutionNote` được vẽ nguyên văn cho mọi người đọc hàng đợi (`ReportRow`),
            kể cả người server đang che tên người báo cáo — ghi chú nêu tên là lộ danh tính người tố giác. */}
        <NoteField
          id={fieldId}
          label={t("admin.moderation.resolve.noteLabel")}
          hint={t("admin.moderation.resolve.noteHint", { max: FEED_NOTE_MAX })}
          warning={t("admin.moderation.resolve.noteWarning")}
          value={note}
          onChange={setNote}
        />

        {/* «Thử lại» = «Xác nhận» trên NHÁP ĐANG THẤY. Nháp chưa gửi được (vd vừa đổi sang «Xoá» mà chưa
            tick) ⇒ không vẽ nút: `submit` sẽ thoát ngay, bấm vào không có gì xảy ra. */}
        {error && (
          <AdminErrorNotice
            reason={error.reason}
            onDismiss={() => setError(null)}
            {...(error.retryable && canSubmit ? { onRetry: submit } : {})}
          />
        )}
      </div>
    </Dialog>
  );
}
