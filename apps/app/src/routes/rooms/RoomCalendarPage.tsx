import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { roomApi, roomKeys, useCan } from "@mediaos/web-core";
import { Button, EmptyState, Input, PageHeader, Select, Skeleton } from "@mediaos/ui";
import { ROOM_PAGE_MAX } from "@mediaos/contracts";
import {
  ROOM_CALENDAR_VIEWS,
  ROOM_ENGINE_PAIRS,
  ROOM_VIEW_DAYS,
  type RoomCalendarView,
} from "./constants";
import {
  addDaysToLocalDate,
  companyTimeZone,
  localDateOf,
  localDateRange,
  startOfWeekLocalDate,
  windowOfLocalDays,
} from "./room-time";
import { parseRoomError, roomErrorI18nKey } from "./room-errors";
import { RoomWeekGrid } from "./components/RoomWeekGrid";
import { RoomBookingDialog } from "./components/RoomBookingDialog";
import { RoomBookingDrawer } from "./components/RoomBookingDrawer";

/** Giờ kết thúc mặc định khi bấm một ô trống: +1 giờ (bội của ROOM_BOOKING_MIN_MINUTES). */
const DEFAULT_DURATION_MINUTES = 60;

function addMinutesToTime(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  const total = h * 60 + m + minutes;
  return `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * ROOM-SCREEN-001 (S11-ROOM-FE-1) — lịch phòng ngày/tuần.
 *
 * Múi giờ: mọi phép quy đổi đi qua `companyTimeZone()` (xem docblock `room-time.ts` về việc
 * `companies.timezone` chưa có đường ra FE). Cửa sổ gửi lên server là ISO CÓ offset, dựng từ ngày
 * LOCAL của công ty — không phải từ `new Date()` của máy người dùng.
 *
 * Hai truy vấn tách rời: `GET /rooms` (cột của lưới, phân trang) và `GET /room-bookings` (nội dung,
 * mảng trần theo cửa sổ). Gộp chúng qua `/rooms/:id/bookings` sẽ thành N+1 request theo số phòng.
 *
 * Endpoint đọc là Company-scope cho MỌI role (SPEC-14 §11) — role có `view:room` ở scope hẹp hơn bị
 * server trả 403 `AUTH-ERR-SCOPE-DENIED` (fail-closed, không trả rỗng giả), nên nhánh lỗi ở đây phải
 * hiện thông điệp chứ không phải trạng thái "chưa có lịch".
 */
export function RoomCalendarPage() {
  const { t } = useTranslation("rooms");
  const timeZone = companyTimeZone();

  const canView = useCan(ROOM_ENGINE_PAIRS.VIEW.action, ROOM_ENGINE_PAIRS.VIEW.resourceType);
  const canBook = useCan(ROOM_ENGINE_PAIRS.BOOK.action, ROOM_ENGINE_PAIRS.BOOK.resourceType);

  const [view, setView] = useState<RoomCalendarView>("week");
  const [anchorDate, setAnchorDate] = useState(() => localDateOf(new Date(), timeZone));
  const [capacityMin, setCapacityMin] = useState("");
  const [roomFilter, setRoomFilter] = useState("");
  const [bookingDialog, setBookingDialog] = useState<{
    localDate: string;
    startTime: string;
    endTime: string;
    roomId?: string;
  } | null>(null);
  const [openBookingId, setOpenBookingId] = useState<string | null>(null);

  const days = ROOM_VIEW_DAYS[view];
  const startDate = view === "week" ? startOfWeekLocalDate(anchorDate) : anchorDate;
  const dayList = useMemo(() => localDateRange(startDate, days), [startDate, days]);
  const window = useMemo(
    () => windowOfLocalDays(startDate, days, timeZone),
    [startDate, days, timeZone],
  );

  // Danh sách phòng: KHÔNG `includeInactive` — lịch chỉ vẽ phòng đang dùng được. Phòng vô hiệu vẫn
  // hiện ở màn quản trị 004 và trong chi tiết lượt cũ (JOIN không lọc), đúng SPEC-14 §12.
  const roomsParams = { page: 1, per_page: ROOM_PAGE_MAX, sort: "sortOrder" as const };
  const roomsQuery = useQuery({
    queryKey: roomKeys.list(roomsParams),
    queryFn: () => roomApi.listRooms(roomsParams),
    enabled: canView,
  });

  const bookingsParams = {
    from: window.from.toISOString(),
    to: window.to.toISOString(),
    status: "Confirmed" as const,
  };
  const bookingsQuery = useQuery({
    queryKey: roomKeys.bookings.list(bookingsParams),
    queryFn: () => roomApi.listBookings(bookingsParams),
    enabled: canView,
  });

  const allRooms = roomsQuery.data?.data ?? [];
  const visibleRooms = useMemo(() => {
    const min = Number.parseInt(capacityMin, 10);
    return allRooms.filter(
      (r) =>
        (roomFilter === "" || r.id === roomFilter) && (!Number.isFinite(min) || r.capacity >= min),
    );
  }, [allRooms, capacityMin, roomFilter]);

  const bookings = bookingsQuery.data ?? [];
  const isLoading = roomsQuery.isLoading || bookingsQuery.isLoading;
  const queryError = roomsQuery.error ?? bookingsQuery.error;

  const shiftBy = (direction: -1 | 1) =>
    setAnchorDate((d) => addDaysToLocalDate(d, direction * days));

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("calendar.title")}
        actions={
          canBook && (
            <Button
              size="sm"
              disabled={visibleRooms.length === 0}
              onClick={() =>
                setBookingDialog({
                  localDate: dayList[0] ?? anchorDate,
                  startTime: "09:00",
                  endTime: addMinutesToTime("09:00", DEFAULT_DURATION_MINUTES),
                })
              }
            >
              {t("calendar.book")}
            </Button>
          )
        }
      />

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            aria-label={t("calendar.prev")}
            onClick={() => shiftBy(-1)}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAnchorDate(localDateOf(new Date(), timeZone))}
          >
            {t("calendar.today")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            aria-label={t("calendar.next")}
            onClick={() => shiftBy(1)}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>

        <label className="text-sm">
          <span className="mb-1 block font-medium">{t("calendar.view.week")}</span>
          <Select value={view} onChange={(e) => setView(e.target.value as RoomCalendarView)}>
            {ROOM_CALENDAR_VIEWS.map((v) => (
              <option key={v} value={v}>
                {t(`calendar.view.${v}`)}
              </option>
            ))}
          </Select>
        </label>

        <label className="text-sm">
          <span className="mb-1 block font-medium">{t("calendar.filterRooms")}</span>
          <Select value={roomFilter} onChange={(e) => setRoomFilter(e.target.value)}>
            <option value="">{t("calendar.allRooms")}</option>
            {allRooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        </label>

        <label className="text-sm">
          <span className="mb-1 block font-medium">{t("calendar.filterCapacity")}</span>
          <Input
            type="number"
            min={1}
            value={capacityMin}
            onChange={(e) => setCapacityMin(e.target.value)}
            className="w-24"
          />
        </label>
      </div>

      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : queryError ? (
        <EmptyState
          title={t(roomErrorI18nKey(parseRoomError(queryError)))}
          action={
            <Button
              variant="outline"
              onClick={() => {
                void roomsQuery.refetch();
                void bookingsQuery.refetch();
              }}
            >
              {t("states.retry")}
            </Button>
          }
        />
      ) : visibleRooms.length === 0 ? (
        <EmptyState title={t("calendar.empty")} />
      ) : (
        <RoomWeekGrid
          days={dayList}
          rooms={visibleRooms}
          bookings={bookings}
          timeZone={timeZone}
          onPickSlot={(roomId, localDate, startTime) => {
            if (!canBook) return;
            setBookingDialog({
              roomId,
              localDate,
              startTime,
              endTime: addMinutesToTime(startTime, DEFAULT_DURATION_MINUTES),
            });
          }}
          onOpenBooking={setOpenBookingId}
        />
      )}

      {bookingDialog && (
        <RoomBookingDialog
          open
          onClose={() => setBookingDialog(null)}
          timeZone={timeZone}
          rooms={allRooms}
          initial={bookingDialog}
          bookings={bookings}
          onBooked={(b) => setOpenBookingId(b.id)}
        />
      )}

      <RoomBookingDrawer
        bookingId={openBookingId}
        timeZone={timeZone}
        onClose={() => setOpenBookingId(null)}
      />
    </div>
  );
}
