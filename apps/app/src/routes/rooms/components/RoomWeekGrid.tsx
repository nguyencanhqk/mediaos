import { useTranslation } from "react-i18next";
import type { RoomBookingResponseDto, RoomResponseDto } from "@mediaos/contracts";
import { ROOM_GRID_END_HOUR, ROOM_GRID_SLOT_MINUTES, ROOM_GRID_START_HOUR } from "../constants";
import { localTimeOf, placeOnDay } from "../room-time";

interface RoomWeekGridProps {
  /** Các ngày local đang vẽ (1 ngày ở chế độ «Ngày», 7 ngày ở «Tuần»). */
  days: readonly string[];
  rooms: readonly RoomResponseDto[];
  bookings: readonly RoomBookingResponseDto[];
  timeZone: string;
  onPickSlot: (roomId: string, localDate: string, startTime: string) => void;
  onOpenBooking: (bookingId: string) => void;
}

const HOURS = Array.from(
  { length: ROOM_GRID_END_HOUR - ROOM_GRID_START_HOUR },
  (_, i) => ROOM_GRID_START_HOUR + i,
);

/**
 * S11-ROOM-FE-1 — lưới lịch phòng: **cột = phòng**, hàng = giờ (SPEC-14 §9 màn 001).
 *
 * Ở chế độ «Tuần», mỗi ngày là một khối lưới riêng xếp dọc — KHÔNG phải một lưới 7×N phòng. Lý do:
 * cột phải luôn là PHÒNG (spec), nên trục ngày chỉ có thể là trục thứ ba; nhồi cả hai vào một hàng
 * cột cho ra 7 × số-phòng cột, không đọc được từ 3 phòng trở lên.
 *
 * Ô trống bấm được để mở form đặt với khung giờ điền sẵn. Ô bận hiện tiêu đề + người tổ chức — đó là
 * dữ liệu dùng chung toàn công ty theo SPEC-14 §11/§18, không phải rò rỉ.
 *
 * Vị trí thẻ tính bằng `placeOnDay` (thuần, có spec riêng) — lượt tràn khung bị KẸP kèm dấu hiệu, chứ
 * không bị lọc bỏ: giấu lịch bận là mời người dùng đặt đè rồi ăn 409.
 */
export function RoomWeekGrid({
  days,
  rooms,
  bookings,
  timeZone,
  onPickSlot,
  onOpenBooking,
}: RoomWeekGridProps) {
  const { t } = useTranslation("rooms");
  const slotsPerHour = 60 / ROOM_GRID_SLOT_MINUTES;

  return (
    <div className="space-y-8">
      {days.map((day) => (
        <section key={day} aria-label={day}>
          <h3 className="mb-2 text-sm font-medium">{day}</h3>
          {/* Bảng rộng cuộn NGANG trong khung riêng — thân trang không được cuộn ngang. */}
          <div className="overflow-x-auto">
            <div
              className="grid min-w-[640px] gap-px bg-border"
              style={{ gridTemplateColumns: `4rem repeat(${rooms.length}, minmax(9rem, 1fr))` }}
            >
              <div className="bg-background" />
              {rooms.map((r) => (
                <div key={r.id} className="bg-background px-2 py-1 text-xs font-medium">
                  {r.name}
                  <span className="ml-1 text-muted-foreground">
                    {t("calendar.capacityUnit", { count: r.capacity })}
                  </span>
                </div>
              ))}

              <div className="bg-background">
                {HOURS.map((h) => (
                  <div
                    key={h}
                    className="h-12 border-t border-border pr-1 text-right text-xs text-muted-foreground"
                  >
                    {String(h).padStart(2, "0")}:00
                  </div>
                ))}
              </div>

              {rooms.map((room) => (
                <div key={room.id} className="relative bg-background">
                  {/* Lớp nền: ô trống bấm được, mỗi ô = ROOM_GRID_SLOT_MINUTES phút. */}
                  {HOURS.map((h) =>
                    Array.from({ length: slotsPerHour }, (_, k) => {
                      const minute = k * ROOM_GRID_SLOT_MINUTES;
                      const time = `${String(h).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
                      return (
                        <button
                          key={time}
                          type="button"
                          title={t("calendar.slotFree")}
                          aria-label={`${room.name} ${day} ${time}`}
                          className="block w-full border-t border-border/60 hover:bg-accent"
                          style={{ height: `${48 / slotsPerHour}px` }}
                          onClick={() => onPickSlot(room.id, day, time)}
                        />
                      );
                    }),
                  )}

                  {/* Lớp trên: các lượt đã đặt, định vị theo % chiều cao khung giờ. */}
                  {bookings
                    .filter((b) => b.room.id === room.id)
                    .map((b) => {
                      const place = placeOnDay(
                        new Date(b.startsAt),
                        new Date(b.endsAt),
                        day,
                        timeZone,
                        ROOM_GRID_START_HOUR,
                        ROOM_GRID_END_HOUR,
                      );
                      if (place === null) return null;
                      return (
                        <button
                          key={b.id}
                          type="button"
                          onClick={() => onOpenBooking(b.id)}
                          className="absolute left-0.5 right-0.5 overflow-hidden rounded-sm bg-brand-muted px-1 py-0.5 text-left text-xs text-brand ring-1 ring-brand/30 hover:ring-brand"
                          style={{ top: `${place.topPct}%`, height: `${place.heightPct}%` }}
                        >
                          <span className="block truncate font-medium">
                            {place.clippedTop && (
                              <span title={t("calendar.clippedBefore")}>↑ </span>
                            )}
                            {localTimeOf(new Date(b.startsAt), timeZone)} {b.title}
                            {place.clippedBottom && (
                              <span title={t("calendar.clippedAfter")}> ↓</span>
                            )}
                          </span>
                          <span className="block truncate text-[10px] opacity-80">
                            {b.organizer.displayName ?? t("calendar.unknownPerson")}
                          </span>
                        </button>
                      );
                    })}
                </div>
              ))}
            </div>
          </div>
        </section>
      ))}
    </div>
  );
}
