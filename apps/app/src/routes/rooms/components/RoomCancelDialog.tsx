import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { meKeys, roomApi, roomKeys } from "@mediaos/web-core";
import { Button, Dialog, Input } from "@mediaos/ui";
import { ROOM_CANCEL_REASON_MAX } from "@mediaos/contracts";
import { parseRoomError, roomErrorI18nKey } from "../room-errors";

interface RoomCancelDialogProps {
  open: boolean;
  bookingId: string;
  onClose: () => void;
  onCancelled: () => void;
}

/**
 * S11-ROOM-FE-1 — hộp thoại huỷ lượt đặt (mở từ drawer 005).
 *
 * Sau khi huỷ phải làm mới **cả hai** nhánh cache: lịch phòng (`roomKeys.bookings.allOf()`) và «Đặt
 * phòng của tôi» (`meKeys.roomBookingsAll()`). Dùng bản PREFIX chứ không phải key mang params của tab
 * đang mở: lượt vừa huỷ NHẢY tab (Sắp tới → Đã huỷ) và nhảy cả sang tuần khác đang nằm trong cache.
 *
 * KHÔNG có Idempotency-Key ở đây: huỷ là thao tác **idempotent theo bản chất** (lần thứ hai trả 409
 * ROOM-ERR-005 `already-cancelled`, không tạo gì thêm), và BE không gắn `@Idempotent()` cho route này.
 */
export function RoomCancelDialog({ open, bookingId, onClose, onCancelled }: RoomCancelDialogProps) {
  const { t } = useTranslation("rooms");
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const cancelMutation = useMutation({
    mutationFn: () =>
      roomApi.cancelBooking(bookingId, {
        reason: reason.trim() === "" ? null : reason.trim(),
      }),
    onSuccess: () => {
      setReason("");
      setError(null);
      void queryClient.invalidateQueries({ queryKey: roomKeys.bookings.allOf() });
      void queryClient.invalidateQueries({ queryKey: meKeys.roomBookingsAll() });
      onCancelled();
      onClose();
    },
    onError: (err) => {
      const info = parseRoomError(err);
      setError(t(roomErrorI18nKey(info), { ...Object.fromEntries(info.fields) }));
    },
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("cancelDialog.title")}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t("cancelDialog.cancel")}
          </Button>
          <Button
            variant="destructive"
            disabled={cancelMutation.isPending}
            onClick={() => cancelMutation.mutate()}
          >
            {cancelMutation.isPending ? t("states.saving") : t("cancelDialog.confirm")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{t("cancelDialog.body")}</p>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t("cancelDialog.reason")}</span>
          <Input
            value={reason}
            maxLength={ROOM_CANCEL_REASON_MAX}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        {error && (
          <p
            role="alert"
            className="rounded-md border border-danger/40 bg-danger-muted px-3 py-2 text-sm text-danger"
          >
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
