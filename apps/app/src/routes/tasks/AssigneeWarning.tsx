import { useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { toast } from "@mediaos/ui";
import type { TaskAssigneeWarning } from "./hooks/use-task-action-mutation";

/**
 * Cảnh báo «người được giao nghỉ phép / không phải thành viên dự án» sau khi giao việc
 * (S20-TASK-ASSIGNWARN-1 · US-TASK-QL-91), hiện qua hệ thông báo chung (S20-FE-TOAST-1 · US-X-91).
 *
 * - Không chặn: việc ĐÃ được giao như server chấp nhận; thông báo chỉ là tín hiệu sớm kèm lối
 *   «Đổi người» (mở lại picker người phụ trách của đúng việc ⇒ 2 thao tác thay vì 4).
 * - A11y nhờ Toaster: biến thể `warning` nằm vùng `aria-live="polite"`; F8 đưa tiêu điểm tới nút đầu
 *   của thông báo mới nhất = «Đổi người»; Esc đóng.
 * - Câu chữ đúng nghĩa server: ON-LEAVE = có đơn nghỉ đã duyệt trùng NGÀY HẠN của việc (không phải
 *   «đang nghỉ hôm nay»). Hạn nghỉ chỉ hiện khi server trả (`until`).
 */
export interface AssigneeWarningNotice {
  readonly taskId: string;
  readonly warnings: readonly TaskAssigneeWarning[];
  readonly assigneeName: string | null | undefined;
  /** Có ⇒ thông báo kèm «Đổi người». Chỉ truyền khi người dùng được giao việc (assign:task). */
  readonly onChangeAssignee?: () => void;
}

const SENTENCE_SEPARATOR = " · ";

/** `YYYY-MM-DD` → `dd/MM` (chuỗi đã được chuẩn hoá, không qua Date ⇒ không lệch múi giờ). */
function toDayMonth(isoDate: string): string {
  const [, month, day] = isoDate.split("-");
  return `${day}/${month}`;
}

/**
 * Câu cảnh báo cho MỘT việc; `null` khi không có gì để báo. Nhiều loại ⇒ một câu gộp, tên người chỉ
 * nêu một lần. Xuất ra để thao tác hàng loạt / quick-add dùng lại cùng câu chữ.
 */
export function formatAssigneeWarning(
  t: TFunction<"tasks">,
  warnings: readonly TaskAssigneeWarning[],
  assigneeName: string | null | undefined,
): string | null {
  if (warnings.length === 0) return null;
  const name = assigneeName?.trim() || t("assigneeWarning.fallbackName");
  const sentences = warnings.map((warning, index) => {
    const subject = index === 0 ? name : "";
    if (warning.kind === "notMember") return t("assigneeWarning.notMember", { name: subject });
    return warning.until
      ? t("assigneeWarning.onLeaveUntil", { name: subject, until: toDayMonth(warning.until) })
      : t("assigneeWarning.onLeave", { name: subject });
  });
  return sentences.map((sentence) => sentence.trim()).join(SENTENCE_SEPARATOR);
}

/**
 * Trả hàm `notify(notice)`: hiện cảnh báo của lần giao vừa xong và ĐÓNG cảnh báo trước đó do chính
 * hook này mở (giao lại cho người khác ⇒ không đọng tên người cũ). Gọi với `warnings` rỗng ⇒ chỉ đóng.
 */
export function useAssigneeWarningToast(): (notice: AssigneeWarningNotice) => void {
  const { t } = useTranslation("tasks");
  const lastToastIdRef = useRef<string | null>(null);

  // Ô giao việc rời màn (đóng drawer / chuyển trang) ⇒ «Đổi người» không còn picker nào để mở —
  // đóng luôn cảnh báo của nó thay vì để lại một nút bấm không làm gì.
  useEffect(
    () => () => {
      if (lastToastIdRef.current) toast.dismiss(lastToastIdRef.current);
    },
    [],
  );

  return useCallback(
    (notice: AssigneeWarningNotice) => {
      if (lastToastIdRef.current) toast.dismiss(lastToastIdRef.current);
      lastToastIdRef.current = null;

      const message = formatAssigneeWarning(t, notice.warnings, notice.assigneeName);
      if (!message) return;
      const { onChangeAssignee } = notice;
      lastToastIdRef.current = toast.warning(message, {
        key: `task-assignee-warning:${notice.taskId}`,
        action: onChangeAssignee
          ? { label: t("assigneeWarning.changeAssignee"), onClick: onChangeAssignee }
          : undefined,
      });
    },
    [t],
  );
}
