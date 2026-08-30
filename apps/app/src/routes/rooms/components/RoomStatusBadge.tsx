import { useTranslation } from "react-i18next";
import { Badge } from "@mediaos/ui";
import { bookingDisplayStatus, type BookingActionSubject } from "../room-actions";
import { ROOM_BOOKING_STATUS_I18N, ROOM_BOOKING_STATUS_VARIANT } from "../constants";

interface RoomStatusBadgeProps {
  booking: BookingActionSubject;
}

/**
 * S11-ROOM-FE-1 — nhãn trạng thái lượt đặt.
 *
 * Trạng thái hiển thị suy từ `status` + `isCompleted` của SERVER (SPEC-14 §10 ROOM-FUNC-010) qua
 * `bookingDisplayStatus` — KHÔNG so `endsAt` với `Date.now()` ở đây. Nhãn tra bảng constants chung
 * (SPEC-01 §17.10), không gõ chuỗi trong JSX.
 */
export function RoomStatusBadge({ booking }: RoomStatusBadgeProps) {
  const { t } = useTranslation("rooms");
  const display = bookingDisplayStatus(booking);
  return (
    <Badge variant={ROOM_BOOKING_STATUS_VARIANT[display]}>
      {t(ROOM_BOOKING_STATUS_I18N[display])}
    </Badge>
  );
}
