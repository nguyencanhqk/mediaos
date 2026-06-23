/**
 * DirtyFormConfirmDialog — dialog xác nhận khi user cố rời form chưa lưu.
 *
 * Dùng chung cho:
 * - Home button click
 * - App Switcher chọn app khác
 * - Logout
 * - Sidebar navigate
 */
import { Dialog } from "@mediaos/ui";
import { Button } from "@mediaos/ui";

interface DirtyFormConfirmDialogProps {
  open: boolean;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DirtyFormConfirmDialog({
  open,
  message,
  confirmLabel = "Rời khỏi",
  onConfirm,
  onCancel,
}: DirtyFormConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title="Thay đổi chưa lưu"
      description={message}
      footer={
        <>
          <Button variant="outline" onClick={onCancel}>
            Ở lại
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {/* Body rỗng — thông tin đủ trong description */}
      <span />
    </Dialog>
  );
}
