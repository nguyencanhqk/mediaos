/**
 * S16-SOCIAL-FE-3 (L3) — hộp thoại SOẠN một báo cáo vi phạm (`SOCIAL-API-027`, `POST /social/reports`).
 * Dùng cho CẢ bài (menu ⋯ của thẻ bài, L3) lẫn bình luận (L8) — đích đến từ prop, không hard-code.
 *
 * ┌─ HỢP ĐỒNG VỚI NƠI MOUNT ─────────────────────────────────────────────────────────────────────────┐
 * │ `{isOpen && <ReportDialog targetType="post" targetId={post.id} onClose={() => setIsOpen(false)} />}`│
 * │  · CHỈ mount khi mở, unmount khi đóng — KHÔNG giữ sẵn với cờ `open`. Hai lý do:                    │
 * │      (1) hộp thoại dùng `useMutation` ⇒ cần `QueryClientProvider`; mount lười để nơi chứa (thẻ     │
 * │          bài, dòng bình luận) vẫn vẽ được ở chỗ không có provider (plan B14);                      │
 * │      (2) MỖI LƯỢT MOUNT = MỘT `attemptId` (xem dưới) — giữ sẵn thì mọi lượt mở dùng chung một khoá.│
 * │  · Nơi mount có thể đổi ĐÍCH mà không mount lại (thẻ bài nhận bài khác) ⇒ phải đóng hộp thoại khi  │
 * │    đích đổi và đặt `key` theo id đích: nháp + `attemptId` thuộc về MỘT đích (`PostCardMenu`).       │
 * │  · `onClose()` — người dùng đóng (nút «Huỷ» / «Đóng» · Esc · bấm ra ngoài). Nơi mount chỉ cần      │
 * │    unmount. KHÔNG được gọi khi đang gửi. Hộp thoại KHÔNG tự đóng sau khi gửi xong: nó đổi sang câu │
 * │    xác nhận, người dùng bấm «Đóng».                                                                │
 * │  · Hộp thoại KHÔNG invalidate cache nào: báo cáo không đổi bài/bình luận, và người gửi không đọc   │
 * │    được hàng đợi kiểm duyệt.                                                                       │
 * └────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Cổng: KHÔNG có cặp riêng — 027 gác bằng `view:feed`, cặp mà người đang nhìn thấy nội dung đã có. Việc
 * ẩn lối vào với nội dung của chính mình là của nơi mount (`isMine`). Server là cổng cuối (403 ⇒ dải lỗi).
 *
 * 🔴 `attemptId` (plan D20 · B22): 027 `@Idempotent` ở server, phản hồi giữ 15 phút theo khoá. Khoá suy từ
 * nội dung THUẦN sẽ phát lại phản hồi cũ cho ca «báo cáo → kiểm duyệt bỏ qua → báo cáo lại y hệt»: màn
 * báo «đã gửi» mà không có báo cáo mới. Nên khoá = băm `{ attemptId, body }` (`createReport`), và
 * `attemptId` sinh ĐÚNG MỘT lần cho mỗi lượt mount: gửi lại trong cùng lượt mở ⇒ cùng khoá (không tạo báo
 * cáo thứ hai); mở lại ⇒ khoá mới.
 *
 * ⚠️ Dòng cảnh báo SOC-DEC-011 LUÔN hiện từ lúc mở, không chờ người dùng gõ: server che TÊN người báo cáo
 * với quản lý đơn vị nhưng trả NGUYÊN VĂN ghi chú — không có dòng này thì chính ghi chú làm lộ danh tính.
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Button, Dialog } from "@mediaos/ui";
import { createIdempotencyKey, socialModerationApi } from "@mediaos/web-core";
import {
  createFeedReportSchema,
  FEED_NOTE_MAX,
  feedReportReasonSchema,
  type CreateFeedReportDto,
  type FeedReportReasonDto,
  type FeedTargetTypeDto,
} from "@mediaos/contracts";
import { AdminErrorNotice } from "../../admin/components/AdminErrorNotice";
import { useGuardedMutation } from "../../admin/lib/use-guarded-mutation";
import { describeCreateReportError } from "../lib/report-create-errors";
import { ChoiceFieldset, DialogActions, NoteField, type KeptError } from "./dialog-fields";

export interface ReportDialogProps {
  /** Loại nội dung bị báo cáo — đi nguyên vào body. */
  targetType: FeedTargetTypeDto;
  /** Id của bài / bình luận bị báo cáo. */
  targetId: string;
  /** Người dùng đóng hộp thoại — nơi mount unmount nó. Không bao giờ được gọi khi đang gửi. */
  onClose: () => void;
}

interface CreateVariables {
  body: CreateFeedReportDto;
  attemptId: string;
}

/** Thứ tự vẽ = thứ tự khai của enum contracts (`chk_feed_reports_reason`). */
const REASONS: readonly FeedReportReasonDto[] = feedReportReasonSchema.options;

/** Ghi chú rỗng sau khi cắt khoảng trắng ⇒ KHÔNG có khoá `note` (server coi vắng = không ghi chú). */
function buildCreateBody(
  targetType: FeedTargetTypeDto,
  targetId: string,
  reason: FeedReportReasonDto,
  note: string,
): CreateFeedReportDto {
  const trimmed = note.trim();
  return {
    targetType,
    targetId,
    reason,
    ...(trimmed === "" ? {} : { note: trimmed }),
  };
}

export function ReportDialog({
  targetType,
  targetId,
  onClose,
}: ReportDialogProps): React.ReactElement {
  const { t } = useTranslation("social");
  const fieldId = React.useId();

  const [reason, setReason] = React.useState<FeedReportReasonDto | null>(null);
  const [note, setNote] = React.useState("");
  const [error, setError] = React.useState<KeptError | null>(null);
  const [isSent, setIsSent] = React.useState(false);

  // MỘT giá trị cho cả lượt mount (xem 🔴 ở đầu file). Khởi tạo lười để không sinh UUID mỗi lần vẽ lại.
  const attemptIdRef = React.useRef<string | null>(null);

  // `useGuardedMutation`: khoá đồng bộ chống gửi đúp, hỏng ngay khi offline, hết hạn chờ thì rơi vào
  // `generic` + «Thử lại» (CÙNG `attemptId` ⇒ cùng khoá idempotency, server đã ghi thì phát lại phản hồi).
  // `keepLockAfterSuccess`: một lượt mount gửi được ĐÚNG MỘT báo cáo — gửi xong thì khoá giữ nguyên.
  const send = useGuardedMutation<unknown, CreateVariables>({
    keepLockAfterSuccess: true,
    mutationFn: ({ body, attemptId }, signal) =>
      socialModerationApi.createReport(body, attemptId, signal),
    onSuccess: () => {
      setError(null);
      setIsSent(true);
    },
    onError: (err) => {
      setError(describeCreateReportError(err));
    },
  });

  const canSubmit = reason !== null && !send.isPending && !isSent;

  const submit = (): void => {
    if (!canSubmit || reason === null) return;
    const body = buildCreateBody(targetType, targetId, reason, note);
    // Lưới cuối trước khi lên dây (vd `targetId` không phải UUID do nơi mount truyền sai).
    if (!createFeedReportSchema.safeParse(body).success) {
      setError({ reason: "invalidRequest", retryable: false });
      return;
    }
    if (send.isLocked()) return;
    attemptIdRef.current ??= createIdempotencyKey();
    if (send.start({ body, attemptId: attemptIdRef.current })) setError(null);
  };

  // Hỏi CẢ cờ đồng bộ: Esc / bấm ra ngoài cùng nhịp với «Gửi báo cáo» thấy `isPending` còn `false`; lọt
  // thì hộp thoại đóng trước khi người gửi biết lượt gửi thành hay hỏng. Gửi xong (`isSent`) thì đóng được.
  const close = (): void => {
    if (isSent || (!send.isPending && !send.isLocked())) onClose();
  };

  const title = t(`admin.report.dialog.title.${targetType}`);

  // Hai trạng thái mang `key` khác nhau ⇒ `Dialog` mount lại và tự đưa focus vào nút «Đóng». Không có
  // `key`, nút «Gửi báo cáo» đang giữ focus biến mất và focus rơi ra ngoài hộp thoại (bẫy Tab hết tác dụng).
  if (isSent) {
    return (
      <Dialog
        key="sent"
        open
        onClose={close}
        title={title}
        footer={
          <Button type="button" onClick={close}>
            {t("admin.report.dialog.close")}
          </Button>
        }
      >
        <p role="status" className="text-sm text-foreground" data-testid="report-dialog-sent">
          {t("admin.report.dialog.sent")}
        </p>
      </Dialog>
    );
  }

  return (
    <Dialog
      key="form"
      open
      onClose={close}
      title={title}
      footer={
        <DialogActions
          cancelLabel={t("admin.report.dialog.cancel")}
          submitLabel={t("admin.report.dialog.submit")}
          isPending={send.isPending}
          canSubmit={canSubmit}
          onCancel={close}
          onSubmit={submit}
        />
      }
    >
      <div className="flex flex-col gap-4" data-testid="report-dialog">
        <ChoiceFieldset
          legend={t("admin.report.dialog.reasonLabel")}
          name={`${fieldId}-reason`}
          options={REASONS.map((value) => ({
            value,
            label: t(`admin.report.reason.${value}`),
          }))}
          value={reason}
          onChange={setReason}
        />

        <NoteField
          id={fieldId}
          label={t("admin.report.dialog.noteLabel")}
          hint={t("admin.report.dialog.noteHint", { max: FEED_NOTE_MAX })}
          warning={t("admin.report.dialog.warning")}
          value={note}
          onChange={setNote}
        />

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
