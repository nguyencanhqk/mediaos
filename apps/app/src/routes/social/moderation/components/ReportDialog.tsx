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
import { useMutation } from "@tanstack/react-query";
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
import type { AdminErrorReason } from "../../admin/lib/admin-errors";
import { describeCreateReportError } from "../lib/report-create-errors";

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

interface KeptError {
  reason: AdminErrorReason;
  retryable: boolean;
}

/** Thứ tự vẽ = thứ tự khai của enum contracts (`chk_feed_reports_reason`). */
const REASONS: readonly FeedReportReasonDto[] = feedReportReasonSchema.options;

const LEGEND_CLASS = "mb-1 text-sm font-medium text-foreground";
const CHOICE_CLASS = "flex items-center gap-2 text-sm text-foreground";

/** Ghi chú rỗng sau khi cắt khoảng trắng ⇒ KHÔNG có khoá `note` (server coi vắng = không ghi chú). */
function buildCreateBody(
  targetType: FeedTargetTypeDto,
  targetId: string,
  reason: FeedReportReasonDto,
  note: string,
): CreateFeedReportDto {
  const trimmed = note.trim();
  return { targetType, targetId, reason, ...(trimmed === "" ? {} : { note: trimmed }) };
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
  // Cờ «đang gửi» đặt ĐỒNG BỘ trong `submit`: `mutation.isPending` tới màn sau một nhịp của react-query,
  // nên hai kích hoạt sát nhau đều thấy nút còn mở. Gỡ khi lỗi (còn gửi lại được); gửi xong thì giữ.
  const isSendingRef = React.useRef(false);

  const mutation = useMutation({
    // Mất mạng thì HỎNG NGAY (rơi vào `onError` ⇒ `generic` + «Thử lại», CÙNG `attemptId`), không «tạm
    // dừng»: mặc định `online` giữ `isPending` vô hạn mà không gọi `onError`, trong khi hộp thoại chặn mọi
    // đường đóng lúc đang gửi — modal không lối ra, không một dòng báo lỗi.
    networkMode: "always",
    // Mọi thứ gửi đi nằm trong `variables` — thân hàm KHÔNG đọc state (v5 nạp lại closure trong effect).
    mutationFn: ({ body, attemptId }: CreateVariables) =>
      socialModerationApi.createReport(body, attemptId),
    onSuccess: () => {
      setError(null);
      setIsSent(true);
    },
    onError: (err: unknown) => {
      isSendingRef.current = false;
      setError(describeCreateReportError(err));
    },
  });

  const canSubmit = reason !== null && !mutation.isPending && !isSent;

  const submit = (): void => {
    if (!canSubmit || reason === null) return;
    const body = buildCreateBody(targetType, targetId, reason, note);
    // Lưới cuối trước khi lên dây (vd `targetId` không phải UUID do nơi mount truyền sai).
    if (!createFeedReportSchema.safeParse(body).success) {
      setError({ reason: "invalidRequest", retryable: false });
      return;
    }
    if (isSendingRef.current) return;
    isSendingRef.current = true;
    attemptIdRef.current ??= createIdempotencyKey();
    setError(null);
    mutation.mutate({ body, attemptId: attemptIdRef.current });
  };

  // Hỏi CẢ cờ đồng bộ: Esc / bấm ra ngoài cùng nhịp với «Gửi báo cáo» thấy `isPending` còn `false`; lọt
  // thì hộp thoại đóng trước khi người gửi biết lượt gửi thành hay hỏng. Gửi xong (`isSent`) thì đóng được.
  const close = (): void => {
    if (isSent || (!mutation.isPending && !isSendingRef.current)) onClose();
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
        <>
          <Button type="button" variant="outline" disabled={mutation.isPending} onClick={close}>
            {t("admin.report.dialog.cancel")}
          </Button>
          <Button
            type="button"
            disabled={!canSubmit}
            aria-busy={mutation.isPending}
            onClick={submit}
          >
            {t("admin.report.dialog.submit")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4" data-testid="report-dialog">
        <fieldset className="flex flex-col gap-2">
          <legend className={LEGEND_CLASS}>{t("admin.report.dialog.reasonLabel")}</legend>
          {REASONS.map((value) => (
            <label key={value} className={CHOICE_CLASS}>
              <input
                type="radio"
                name={`${fieldId}-reason`}
                checked={reason === value}
                onChange={() => setReason(value)}
              />
              {t(`admin.report.reason.${value}`)}
            </label>
          ))}
        </fieldset>

        <div className="flex flex-col gap-1 text-sm">
          <label htmlFor={`${fieldId}-note`} className="font-medium text-foreground">
            {t("admin.report.dialog.noteLabel")}
          </label>
          <p
            id={`${fieldId}-warning`}
            role="note"
            className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-foreground"
          >
            {t("admin.report.dialog.warning")}
          </p>
          <textarea
            id={`${fieldId}-note`}
            aria-describedby={`${fieldId}-warning ${fieldId}-note-hint`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={FEED_NOTE_MAX}
            rows={3}
            className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <p id={`${fieldId}-note-hint`} className="text-xs text-muted-foreground">
            {t("admin.report.dialog.noteHint", { max: FEED_NOTE_MAX })}
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
