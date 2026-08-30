import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { roomApi, roomKeys, useCan } from "@mediaos/web-core";
import {
  Badge,
  Button,
  Checkbox,
  EmptyState,
  Input,
  PageHeader,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@mediaos/ui";
import { ROOM_PAGE_MAX, type RoomResponseDto } from "@mediaos/contracts";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import {
  ROOM_ACTIVE_I18N,
  ROOM_ENGINE_PAIRS,
  ROOM_HISTORY_MAX_DAYS,
  ROOM_USAGE_DEFAULT_DAYS,
} from "./constants";
import { addDaysToLocalDate, companyTimeZone, localDateOf, wallTimeToInstant } from "./room-time";
import { parseRoomError, roomErrorI18nKey } from "./room-errors";
import { RoomFormDialog } from "./components/RoomFormDialog";

/**
 * ROOM-SCREEN-004 (S11-ROOM-FE-1) — quản trị phòng họp + tab «Lịch sử sử dụng».
 *
 * Gate màn = cặp ĐỌC (`access:room` + `view:room`), KHÔNG phải `manage:room` — xem ghi chú ở
 * ROUTE_REGISTRY: tab lịch sử chạy trên `view:room`, khoá cả màn bằng cặp ghi sẽ giấu luôn phần đọc
 * khỏi role chỉ có quyền xem. Các nút tạo/sửa/vô hiệu/xoá ẩn riêng qua `useCan(manage:room)`.
 *
 * Nút «Vô hiệu»/«Xoá» KHÔNG ẩn theo `upcomingCount` ở màn danh sách: khoá đó chỉ có ở chi tiết
 * (contracts `.optional()`), và ở đây nó LUÔN vắng. Đoán "vắng = còn lịch" sẽ khoá cứng thao tác hợp
 * lệ; server chặn bằng 409 ROOM-ERR-008 kèm `upcomingCount` thật và ta hiện đúng con số đó.
 */
export function RoomManagePage() {
  const { t } = useTranslation("rooms");
  const timeZone = companyTimeZone();
  const queryClient = useQueryClient();

  const canView = useCan(ROOM_ENGINE_PAIRS.VIEW.action, ROOM_ENGINE_PAIRS.VIEW.resourceType);
  const canManage = useCan(ROOM_ENGINE_PAIRS.MANAGE.action, ROOM_ENGINE_PAIRS.MANAGE.resourceType);

  const [tab, setTab] = useState("rooms");
  const [search, setSearch] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [formRoom, setFormRoom] = useState<RoomResponseDto | null | undefined>(undefined);
  const [deleteTarget, setDeleteTarget] = useState<RoomResponseDto | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);

  const today = localDateOf(new Date(), timeZone);
  const [usageFrom, setUsageFrom] = useState(() =>
    addDaysToLocalDate(today, -ROOM_USAGE_DEFAULT_DAYS),
  );
  const [usageTo, setUsageTo] = useState(today);

  const listParams = {
    page: 1,
    per_page: ROOM_PAGE_MAX,
    sort: "sortOrder" as const,
    ...(includeInactive ? { includeInactive: true } : {}),
    ...(search.trim() === "" ? {} : { q: search.trim() }),
  };
  const listQuery = useQuery({
    queryKey: roomKeys.list(listParams),
    queryFn: () => roomApi.listRooms(listParams),
    enabled: canView,
  });

  // Cửa sổ usage: `to` là 00:00 của ngày SAU ngày người dùng chọn — người ta nghĩ theo khoảng ĐÓNG
  // ("từ 01 đến 30"), hợp đồng là nửa mở. Không cộng 1 ngày ở đây thì lượt của chính ngày cuối rơi ra
  // ngoài và bảng thống kê thiếu đúng một ngày mà không ai thấy.
  const usageWindow = useMemo(
    () => ({
      from: wallTimeToInstant(usageFrom, "00:00", timeZone).toISOString(),
      to: wallTimeToInstant(addDaysToLocalDate(usageTo, 1), "00:00", timeZone).toISOString(),
    }),
    [usageFrom, usageTo, timeZone],
  );
  const usageDays = useMemo(() => {
    const ms = new Date(usageWindow.to).getTime() - new Date(usageWindow.from).getTime();
    return ms / 86_400_000;
  }, [usageWindow]);
  const usageRangeValid = usageDays > 0 && usageDays <= ROOM_HISTORY_MAX_DAYS;

  const usageQuery = useQuery({
    queryKey: roomKeys.usageSummary(usageWindow),
    queryFn: () => roomApi.usageSummary(usageWindow),
    enabled: canView && tab === "usage" && usageRangeValid,
  });

  const onMutationError = (err: unknown) => {
    const info = parseRoomError(err);
    setMutationError(t(roomErrorI18nKey(info), { ...Object.fromEntries(info.fields) }));
  };

  const toggleActiveMutation = useMutation({
    mutationFn: (room: RoomResponseDto) =>
      roomApi.updateRoom(room.id, { isActive: !room.isActive }),
    onSuccess: () => {
      setMutationError(null);
      void queryClient.invalidateQueries({ queryKey: roomKeys.all });
    },
    onError: onMutationError,
  });

  const deleteMutation = useMutation({
    mutationFn: (room: RoomResponseDto) => roomApi.deleteRoom(room.id),
    onSuccess: () => {
      setMutationError(null);
      setDeleteTarget(null);
      void queryClient.invalidateQueries({ queryKey: roomKeys.all });
    },
    onError: onMutationError,
  });

  const rooms = listQuery.data?.data ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("manage.title")}
        actions={
          canManage && (
            <Button size="sm" onClick={() => setFormRoom(null)}>
              <Plus className="mr-2 size-4" />
              {t("manage.create")}
            </Button>
          )
        }
      />

      {mutationError && (
        <p
          role="alert"
          className="rounded-md border border-danger/40 bg-danger-muted px-3 py-2 text-sm text-danger"
        >
          {mutationError}
        </p>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="rooms">{t("manage.tabs.rooms")}</TabsTrigger>
          <TabsTrigger value="usage">{t("manage.tabs.usage")}</TabsTrigger>
        </TabsList>

        <TabsContent value="rooms">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <Input
              placeholder={t("manage.search")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-64"
            />
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={includeInactive}
                onChange={(e) => setIncludeInactive(e.target.checked)}
              />
              {t("manage.showInactive")}
            </label>
          </div>

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
          ) : rooms.length === 0 ? (
            <EmptyState title={t("manage.empty")} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="py-2 pr-3">{t("manage.columns.name")}</th>
                    <th className="py-2 pr-3">{t("manage.columns.capacity")}</th>
                    <th className="py-2 pr-3">{t("manage.columns.equipment")}</th>
                    <th className="py-2 pr-3">{t("manage.columns.location")}</th>
                    <th className="py-2 pr-3">{t("manage.columns.status")}</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody>
                  {rooms.map((room) => (
                    <tr key={room.id} className="border-b border-border/60">
                      <td className="py-2 pr-3 font-medium">{room.name}</td>
                      <td className="py-2 pr-3">{room.capacity}</td>
                      <td className="py-2 pr-3 text-muted-foreground">
                        {room.equipment.join(", ") || "—"}
                      </td>
                      <td className="py-2 pr-3 text-muted-foreground">{room.location ?? "—"}</td>
                      <td className="py-2 pr-3">
                        <Badge variant={room.isActive ? "success" : "muted"}>
                          {t(room.isActive ? ROOM_ACTIVE_I18N.active : ROOM_ACTIVE_I18N.inactive)}
                        </Badge>
                        {room.requiresApproval && (
                          <Badge variant="warning" className="ml-1">
                            {t("roomForm.requiresApproval")}
                          </Badge>
                        )}
                      </td>
                      <td className="py-2 text-right">
                        {canManage && (
                          <span className="inline-flex gap-2">
                            <Button variant="outline" size="sm" onClick={() => setFormRoom(room)}>
                              {t("manage.edit")}
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={toggleActiveMutation.isPending}
                              onClick={() => toggleActiveMutation.mutate(room)}
                            >
                              {room.isActive ? t("manage.deactivate") : t("manage.activate")}
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(room)}>
                              {t("manage.delete")}
                            </Button>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="usage">
          <div className="mb-4 flex flex-wrap items-end gap-3">
            <label className="text-sm">
              <span className="mb-1 block font-medium">{t("manage.usage.from")}</span>
              <Input type="date" value={usageFrom} onChange={(e) => setUsageFrom(e.target.value)} />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium">{t("manage.usage.to")}</span>
              <Input type="date" value={usageTo} onChange={(e) => setUsageTo(e.target.value)} />
            </label>
          </div>

          {!usageRangeValid ? (
            <EmptyState title={t("manage.usage.rangeTooWide", { max: ROOM_HISTORY_MAX_DAYS })} />
          ) : usageQuery.isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : usageQuery.isError ? (
            <EmptyState
              title={t(roomErrorI18nKey(parseRoomError(usageQuery.error)))}
              action={
                <Button variant="outline" onClick={() => void usageQuery.refetch()}>
                  {t("states.retry")}
                </Button>
              }
            />
          ) : (usageQuery.data ?? []).length === 0 ? (
            <EmptyState title={t("manage.usage.empty")} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="py-2 pr-3">{t("manage.usage.room")}</th>
                    <th className="py-2 pr-3">{t("manage.usage.bookings")}</th>
                    <th className="py-2 pr-3">{t("manage.usage.hours")}</th>
                    <th className="py-2">{t("manage.usage.cancelled")}</th>
                  </tr>
                </thead>
                <tbody>
                  {(usageQuery.data ?? []).map((row) => (
                    <tr key={row.roomId} className="border-b border-border/60">
                      <td className="py-2 pr-3 font-medium">{row.name}</td>
                      <td className="py-2 pr-3">{row.bookingsCount}</td>
                      <td className="py-2 pr-3">{row.hoursBooked}</td>
                      <td className="py-2">{row.cancelledCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {formRoom !== undefined && (
        <RoomFormDialog open room={formRoom} onClose={() => setFormRoom(undefined)} />
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        title={t("manage.delete")}
        description={t("manage.deleteConfirm", { name: deleteTarget?.name ?? "" })}
        confirmLabel={t("manage.delete")}
        cancelLabel={t("roomForm.cancel")}
        destructive
        busy={deleteMutation.isPending}
        busyLabel={t("states.saving")}
        onConfirm={() => {
          if (deleteTarget) deleteMutation.mutate(deleteTarget);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
