import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { formatDateTime, meKeys, roomApi, useCan } from "@mediaos/web-core";
import {
  Button,
  EmptyState,
  PageHeader,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@mediaos/ui";
import {
  ME_BOOKING_TABS,
  ME_TAB_DAYS,
  ROOM_ENGINE_PAIRS,
  type MeBookingTab,
} from "@/routes/rooms/constants";
import {
  addDaysToLocalDate,
  companyTimeZone,
  localDateOf,
  wallTimeToInstant,
} from "@/routes/rooms/room-time";
import { parseRoomError, roomErrorI18nKey } from "@/routes/rooms/room-errors";
import { RoomStatusBadge } from "@/routes/rooms/components/RoomStatusBadge";
import { RoomBookingDrawer } from "@/routes/rooms/components/RoomBookingDrawer";

/**
 * ROOM-SCREEN-003 (S11-ROOM-FE-1) — «Đặt phòng của tôi», mount trong ME workspace.
 *
 * `GET /me/room-bookings` KHÔNG nhận tham số người dùng — user resolve từ token (chống IDOR, SPEC-14
 * §12). Trang này vì thế không có khái niệm "xem lịch của người khác"; muốn thế thì đi màn 001 (lịch
 * công ty, dữ liệu dùng chung).
 *
 * Ba tab khác nhau ở **cửa sổ** + `includeCancelled`, không ở chỗ lọc client:
 *  - Sắp tới: `[hôm nay, +31 ngày)`, chỉ Confirmed;
 *  - Đã qua:  `[−30 ngày, ngày mai)`, chỉ Confirmed (lượt đã kết thúc mang `isCompleted = true`);
 *  - Đã huỷ:  `[−15, +16)` với `includeCancelled` — lọc `status === "Cancelled"` ở client vì endpoint
 *    trả CẢ hai loại khi bật cờ (không có tham số "chỉ lấy đã huỷ").
 *
 * Cửa sổ mỗi tab ≤ 31 ngày (`ME_TAB_DAYS`) — dài hơn là 422 ROOM-ERR-002 `range-too-wide`.
 *
 * Nút Huỷ KHÔNG ở đây: SPEC-14 §9 đặt nó ở drawer 005 (nơi duy nhất), và ở đó nó đi theo `canCancel`
 * mà server tính lại trên chi tiết mới nhất.
 */
export function MeRoomBookingsPage() {
  const { t } = useTranslation("rooms");
  const timeZone = companyTimeZone();

  const canView = useCan(ROOM_ENGINE_PAIRS.VIEW.action, ROOM_ENGINE_PAIRS.VIEW.resourceType);
  const [tab, setTab] = useState<MeBookingTab>("upcoming");
  const [openBookingId, setOpenBookingId] = useState<string | null>(null);

  const query = useMemo(() => {
    const today = localDateOf(new Date(), timeZone);
    const { back, forward } = ME_TAB_DAYS[tab];
    return {
      from: wallTimeToInstant(addDaysToLocalDate(today, -back), "00:00", timeZone).toISOString(),
      to: wallTimeToInstant(
        addDaysToLocalDate(today, forward),
        "00:00",
        timeZone,
      ).toISOString(),
      role: "all" as const,
      ...(tab === "cancelled" ? { includeCancelled: true } : {}),
    };
  }, [tab, timeZone]);

  const listQuery = useQuery({
    queryKey: meKeys.roomBookings(query),
    queryFn: () => roomApi.listMyBookings(query),
    enabled: canView,
  });

  const rows = useMemo(() => {
    const data = listQuery.data ?? [];
    return tab === "cancelled" ? data.filter((b) => b.status === "Cancelled") : data;
  }, [listQuery.data, tab]);

  return (
    <div className="space-y-6">
      <PageHeader title={t("me.title")} />

      <Tabs value={tab} onValueChange={(v) => setTab(v as MeBookingTab)}>
        <TabsList>
          {ME_BOOKING_TABS.map((key) => (
            <TabsTrigger key={key} value={key}>
              {t(`me.tabs.${key}`)}
            </TabsTrigger>
          ))}
        </TabsList>

        {ME_BOOKING_TABS.map((key) => (
          <TabsContent key={key} value={key}>
            {listQuery.isLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : listQuery.isError ? (
              <EmptyState
                title={t(roomErrorI18nKey(parseRoomError(listQuery.error)))}
                action={
                  <Button variant="outline" onClick={() => void listQuery.refetch()}>
                    {t("states.retry")}
                  </Button>
                }
              />
            ) : rows.length === 0 ? (
              <EmptyState title={t(`me.empty.${key}`)} />
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {rows.map((b) => (
                  <li key={b.id}>
                    <button
                      type="button"
                      className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left text-sm hover:bg-accent"
                      onClick={() => setOpenBookingId(b.id)}
                    >
                      <span className="font-medium">{b.title}</span>
                      <span className="text-muted-foreground">{b.room.name}</span>
                      <span className="text-muted-foreground">
                        {formatDateTime(b.startsAt, timeZone)} –{" "}
                        {formatDateTime(b.endsAt, timeZone)}
                      </span>
                      <RoomStatusBadge booking={b} />
                      <span className="ml-auto text-xs text-muted-foreground">
                        {t(`me.role.${b.myRole}`)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>
        ))}
      </Tabs>

      <RoomBookingDrawer
        bookingId={openBookingId}
        timeZone={timeZone}
        onClose={() => setOpenBookingId(null)}
      />
    </div>
  );
}
