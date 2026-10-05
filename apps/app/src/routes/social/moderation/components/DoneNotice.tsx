/**
 * S16-SOCIAL-FE-3 — dải «đã làm xong» của màn Kiểm duyệt (kết thúc báo cáo · hiện lại bài). MỘT khuôn cho
 * cả hai tab: cùng `role="status"`, cùng nút «Đóng thông báo» — trước đây dải của tab «Bài đang ẩn» không
 * đóng được trong khi dải của tab «Báo cáo» thì có.
 *
 * Dải LỖI không ở đây: lỗi vẽ bằng `AdminErrorNotice` (`role="alert"`).
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";

interface DoneNoticeProps {
  /** Câu đã qua `t`. */
  message: string;
  onDismiss: () => void;
}

export function DoneNotice({ message, onDismiss }: DoneNoticeProps): React.ReactElement {
  const { t } = useTranslation("social");
  return (
    <div
      role="status"
      className="flex items-start justify-between gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2"
    >
      <p className="text-sm text-foreground">{message}</p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={t("admin.notice.dismiss")}
        className="rounded p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}
