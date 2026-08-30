import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { roomApi, roomKeys, useCan, formatDateTime } from "@mediaos/web-core";
import { Button, EmptyState, Sheet, Skeleton } from "@mediaos/ui";
import { ROOM_ENGINE_PAIRS } from "../constants";
import { canShowCancelButton } from "../room-actions";
import { parseRoomError, roomErrorI18nKey } from "../room-errors";
import { RoomStatusBadge } from "./RoomStatusBadge";
import { RoomCancelDialog } from "./RoomCancelDialog";

interface RoomBookingDrawerProps {
  bookingId: string | null;
  timeZone: string;
  onClose: () => void;
}

/**
 * ROOM-SCREEN-005 (S11-ROOM-FE-1) — drawer chi tiết lượt đặt, mở từ màn 001/003/004.
 *
 * Đây là **nơi DUY NHẤT có nút Huỷ** (SPEC-14 §9) — và nút đó đi theo `canCancel` mà SERVER tính, chứ
 * không theo suy luận `organizer === me` ở FE (xem docblock `room-actions.ts`). Lý do drawer luôn
 * `GET /room-bookings/:id` thay vì dùng lại object từ lưới: cờ `canCancel` chỉ đúng tại thời điểm
 * server trả về, và lưới có thể đã nằm trong cache từ vài phút trước — lúc đó lượt "còn huỷ được" có
 * thể đã kết thúc.
 *
 * Người tham dự hiện tên từ `attendees[].displayName`; `null` = ngoài scope danh tính của người xem
 * (server mask), KHÔNG phải "không có tên" — hiện nhãn trung tính thay vì để trống.
 */
export function RoomBookingDrawer({ bookingId, timeZone, onClose }: RoomBookingDrawerProps) {
  const { t } = useTranslation("rooms");
  const [cancelOpen, setCancelOpen] = useState(false);

  const canCancelPair = useCan(
    ROOM_ENGINE_PAIRS.CANCEL.action,
    ROOM_ENGINE_PAIRS.CANCEL.resourceType,
  );

  const detailQuery = useQuery({
    queryKey: roomKeys.bookings.detail(bookingId ?? ""),
    queryFn: () => roomApi.getBooking(bookingId as string),
    enabled: bookingId !== null,
  });

  const booking = detailQuery.data ?? null;
  const showCancel = booking !== null && canShowCancelButton(booking, canCancelPair);
  const personName = (name: string | null) => name ?? t("calendar.unknownPerson");

  return (
    <>
      <Sheet
        open={bookingId !== null}
        onClose={onClose}
        title={t("detail.title")}
        actions={
          showCancel ? (
            <Button variant="destructive" size="sm" onClick={() => setCancelOpen(true)}>
              {t("detail.cancel")}
            </Button>
          ) : undefined
        }
      >
        {detailQuery.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : detailQuery.isError ? (
          <EmptyState
            title={t(roomErrorI18nKey(parseRoomError(detailQuery.error)))}
            action={
              <Button variant="outline" onClick={() => void detailQuery.refetch()}>
                {t("states.retry")}
              </Button>
            }
          />
        ) : booking === null ? null : (
          <dl className="space-y-4 text-sm">
            <div>
              <dt className="font-medium">{booking.title}</dt>
              <dd className="mt-1">
                <RoomStatusBadge booking={booking} />
              </dd>
            </div>
            <Row label={t("detail.room")}>
              {booking.room.name}
              {booking.room.location ? ` · ${booking.room.location}` : ""}
            </Row>
            <Row label={t("detail.time")}>
              {formatDateTime(booking.startsAt, timeZone)} –{" "}
              {formatDateTime(booking.endsAt, timeZone)}
            </Row>
            <Row label={t("detail.organizer")}>{personName(booking.organizer.displayName)}</Row>
            {/* `bookedBy` chỉ khác organizer khi Office Admin đặt hộ — dấu vết «ai đã đặt» của SPEC-14
                §18. Vắng (null) khi tự đặt ⇒ KHÔNG render hàng rỗng. */}
            {booking.bookedBy && booking.bookedBy.userId !== booking.organizer.userId && (
              <Row label={t("detail.bookedBy")}>{personName(booking.bookedBy.displayName)}</Row>
            )}
            <div>
              <dt className="font-medium">{t("detail.attendees")}</dt>
              <dd className="mt-1 text-muted-foreground">
                {booking.attendees.length === 0 ? (
                  t("detail.noAttendees")
                ) : (
                  <ul className="list-disc pl-4">
                    {booking.attendees.map((a) => (
                      <li key={a.userId}>{personName(a.displayName)}</li>
                    ))}
                  </ul>
                )}
              </dd>
            </div>
            {booking.description && <Row label={t("form.description")}>{booking.description}</Row>}
            {booking.status === "Cancelled" && (
              <>
                {booking.cancelledAt && (
                  <Row label={t("detail.cancelledAt")}>
                    {formatDateTime(booking.cancelledAt, timeZone)}
                  </Row>
                )}
                {booking.cancelledBy && (
                  <Row label={t("detail.cancelledBy")}>
                    {personName(booking.cancelledBy.displayName)}
                  </Row>
                )}
                {booking.cancelReason && (
                  <Row label={t("detail.cancelReason")}>{booking.cancelReason}</Row>
                )}
              </>
            )}
          </dl>
        )}
      </Sheet>

      {booking !== null && (
        <RoomCancelDialog
          open={cancelOpen}
          bookingId={booking.id}
          onClose={() => setCancelOpen(false)}
          onCancelled={() => {
            void detailQuery.refetch();
          }}
        />
      )}
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="font-medium">{label}</dt>
      <dd className="mt-0.5 text-muted-foreground">{children}</dd>
    </div>
  );
}
