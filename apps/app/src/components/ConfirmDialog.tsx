/**
 * ConfirmDialog — xác nhận hành động mutation (FRONTEND-13 §6.6).
 *
 * Bọc primitive `Dialog` của @mediaos/ui: tiêu đề + mô tả + nút Huỷ/Xác nhận. Dùng TRƯỚC mọi PATCH
 * có side-effect (cập nhật hồ sơ công ty, đổi giá trị cấu hình nhạy cảm) để tránh mutation vô ý.
 *
 * KHÔNG chứa/log giá trị nhạy cảm: caller chỉ truyền title/description an toàn (BẤT BIẾN #3).
 */
import { Button, Dialog } from "@mediaos/ui";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel: string;
  cancelLabel: string;
  /** true → nút xác nhận biến thể destructive (hành động rủi ro). */
  destructive?: boolean;
  /** true → khoá nút + đổi nhãn sang trạng thái đang xử lý. */
  busy?: boolean;
  busyLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  destructive = false,
  busy = false,
  busyLabel,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={busy ? () => {} : onCancel}
      title={title}
      description={description}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={destructive ? "destructive" : "default"}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? (busyLabel ?? confirmLabel) : confirmLabel}
          </Button>
        </>
      }
    >
      {/* Body giữ trống có chủ đích — nội dung nằm ở description (an toàn, không giá trị nhạy cảm). */}
      <span className="sr-only">{title}</span>
    </Dialog>
  );
}
