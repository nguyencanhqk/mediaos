import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { createIdempotencyKey, meKeys, roomApi, roomKeys, useCan } from "@mediaos/web-core";
import { Button, Dialog, Input, Select } from "@mediaos/ui";
import {
  ROOM_BOOKING_TITLE_MAX,
  ROOM_MAX_ATTENDEES,
  type RoomBookingResponseDto,
  type RoomResponseDto,
} from "@mediaos/contracts";
import type { HrEmployeeListItem } from "@mediaos/contracts";
import { EmployeeMultiPickerDialog } from "@/components/EmployeeMultiPickerDialog";
import {
  ROOM_ENGINE_PAIRS,
  ROOM_GRID_END_HOUR,
  ROOM_GRID_SLOT_MINUTES,
  ROOM_GRID_START_HOUR,
} from "../constants";
import { exceedsCapacity, headcountOf, isRoomBookable } from "../room-actions";
import {
  parseRoomError,
  readRoomConflicts,
  roomBookingErrorAction,
  roomErrorI18nKey,
} from "../room-errors";
import { localTimeOf, overlaps, timeSlots, wallTimeToInstant } from "../room-time";

interface AttendeePick {
  readonly userId: string;
  readonly label: string;
}

interface RoomBookingDialogProps {
  open: boolean;
  onClose: () => void;
  timeZone: string;
  /** Danh sách phòng để chọn (đã tải ở màn cha). */
  rooms: readonly RoomResponseDto[];
  /** Khung giờ người dùng kéo chọn trên lưới, hoặc mặc định của màn. */
  initial: { localDate: string; startTime: string; endTime: string; roomId?: string };
  /** Lượt `Confirmed` đang hiển thị — nguồn kiểm trùng CLIENT (cảnh báo, không chặn). */
  bookings: readonly RoomBookingResponseDto[];
  onBooked: (booking: RoomBookingResponseDto) => void;
}

/**
 * ROOM-SCREEN-002 (S11-ROOM-FE-1) — form đặt phòng.
 *
 * Ba thứ ở đây là bản chất của màn, không phải trang trí:
 *
 * 1. **Idempotency-Key do FE sinh, đúng 3 mốc** (SPEC-14 §12): mở form · sau gửi THÀNH CÔNG · sau
 *    `KEY_REUSED`. KHÔNG suy từ payload — "huỷ rồi đặt lại y hệt trong 15′" là thao tác HỢP LỆ mà
 *    khoá suy-từ-payload sẽ phát lại lượt đã huỷ (memory `idempotency-key-must-be-content-derived`).
 *    Đặc biệt KHÔNG sinh khoá mới khi gặp `IN_PROGRESS`: khoá cũ chính là cái đang bảo vệ người dùng
 *    khỏi bấm-đúp.
 *
 * 2. **Lỗi rẽ theo `error.code`, không theo HTTP status** — bốn nhánh ở `roomBookingErrorAction`.
 *    Form KHÔNG mất dữ liệu ở nhánh nào.
 *
 * 3. **Kiểm trùng client là CẢNH BÁO, không phải khoá.** Dữ liệu lịch trong tay có thể đã cũ; chặn
 *    cứng nút Gửi bằng cache là dựng một oracle sai (người dùng không đặt được khung thật ra đang
 *    trống). Chốt cuối là EXCLUDE ở DB → 409 ROOM-ERR-001, và ta hiện đúng khung bận server trả về.
 */
export function RoomBookingDialog({
  open,
  onClose,
  timeZone,
  rooms,
  initial,
  bookings,
  onBooked,
}: RoomBookingDialogProps) {
  const { t } = useTranslation("rooms");
  const queryClient = useQueryClient();

  // Scope `book` = Company ⇒ được đặt hộ. `useCan` trả true khi có cặp ở BẤT KỲ scope nào, nên nó
  // KHÔNG phân biệt Own/Company — vì thế ô «Đặt hộ cho» hiện cho mọi người có `book:room`, và server
  // chặn bằng 403 ROOM-ERR-010 `book-on-behalf-denied` nếu scope là Own. Ẩn ô theo suy đoán scope ở
  // FE sẽ khoá nhầm Office Admin có role tuỳ biến (`superadmin-not-a-canonical-role` họ hàng).
  const canBook = useCan(ROOM_ENGINE_PAIRS.BOOK.action, ROOM_ENGINE_PAIRS.BOOK.resourceType);

  const [roomId, setRoomId] = useState(initial.roomId ?? "");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [localDate, setLocalDate] = useState(initial.localDate);
  const [startTime, setStartTime] = useState(initial.startTime);
  const [endTime, setEndTime] = useState(initial.endTime);
  const [attendees, setAttendees] = useState<readonly AttendeePick[]>([]);
  const [organizer, setOrganizer] = useState<AttendeePick | null>(null);
  const [pickerOpen, setPickerOpen] = useState<"attendees" | "organizer" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [serverConflicts, setServerConflicts] =
    useState<ReturnType<typeof readRoomConflicts>>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(() => createIdempotencyKey("room-booking"));

  // Mở form = một Ý ĐỊNH ĐẶT MỚI ⇒ khoá mới + dọn sạch trạng thái lỗi của lần trước. Không reset ở
  // đây thì lần mở thứ hai mang theo khoá đã tiêu và ăn ngay KEY_REUSED.
  useEffect(() => {
    if (!open) return;
    setIdempotencyKey(createIdempotencyKey("room-booking"));
    setRoomId(initial.roomId ?? "");
    setLocalDate(initial.localDate);
    setStartTime(initial.startTime);
    setEndTime(initial.endTime);
    setTitle("");
    setDescription("");
    setAttendees([]);
    setOrganizer(null);
    setError(null);
    setServerConflicts(null);
  }, [open, initial.roomId, initial.localDate, initial.startTime, initial.endTime]);

  const bookableRooms = useMemo(() => rooms.filter(isRoomBookable), [rooms]);
  const selectedRoom = bookableRooms.find((r) => r.id === roomId) ?? null;

  const startsAt = useMemo(
    () => wallTimeToInstant(localDate, startTime, timeZone),
    [localDate, startTime, timeZone],
  );
  const endsAt = useMemo(
    () => wallTimeToInstant(localDate, endTime, timeZone),
    [localDate, endTime, timeZone],
  );

  /** Trùng theo DỮ LIỆU ĐANG HIỂN THỊ — cảnh báo, không chặn (xem docblock §3). */
  const clientConflicts = useMemo(() => {
    if (!roomId) return [];
    return bookings.filter(
      (b) =>
        b.room.id === roomId &&
        b.status === "Confirmed" &&
        overlaps(startsAt, endsAt, new Date(b.startsAt), new Date(b.endsAt)),
    );
  }, [bookings, roomId, startsAt, endsAt]);

  const overCapacity = exceedsCapacity(selectedRoom?.capacity ?? null, attendees.length);

  const createMutation = useMutation({
    mutationFn: (key: string) =>
      roomApi.createBooking(
        {
          roomId,
          title: title.trim(),
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
          description: description.trim() === "" ? null : description.trim(),
          attendeeUserIds: attendees.map((a) => a.userId),
          ...(organizer ? { organizerUserId: organizer.userId } : {}),
        },
        key,
      ),
    onSuccess: (booking) => {
      // Gửi THÀNH CÔNG ⇒ ý định đã tiêu ⇒ khoá mới cho lần sau (mốc 2/3 của SPEC-14 §12).
      setIdempotencyKey(createIdempotencyKey("room-booking"));
      setError(null);
      setServerConflicts(null);
      void queryClient.invalidateQueries({ queryKey: roomKeys.bookings.allOf() });
      void queryClient.invalidateQueries({ queryKey: meKeys.roomBookingsAll() });
      onBooked(booking);
      onClose();
    },
    onError: (err) => {
      const info = parseRoomError(err);
      const action = roomBookingErrorAction(info);
      setServerConflicts(action === "show-conflicts" ? readRoomConflicts(info) : null);
      setError(t(roomErrorI18nKey(info), { ...Object.fromEntries(info.fields) }));
      if (action === "retry-new-key") {
        // Khoá đã tiêu cho một payload KHÁC ⇒ khoá mới rồi để người dùng bấm gửi lại. KHÔNG tự động
        // gửi lại: người dùng vừa đổi nội dung, họ phải thấy mình đang gửi cái gì.
        setIdempotencyKey(createIdempotencyKey("room-booking"));
      }
      // `wait` (IN_PROGRESS): GIỮ NGUYÊN khoá — nó đang là cái chặn bấm-đúp.
    },
  });

  const slots = timeSlots(ROOM_GRID_START_HOUR, ROOM_GRID_END_HOUR, ROOM_GRID_SLOT_MINUTES);
  const canSubmit = canBook && roomId !== "" && title.trim() !== "" && !createMutation.isPending;

  const addAttendee = (emp: HrEmployeeListItem) => {
    // Nhân viên chưa liên kết tài khoản (userId null) KHÔNG đặt lịch hộ được — BE nhận userId, không
    // nhận employeeId. Bỏ qua im lặng là để người dùng tưởng đã thêm; báo lỗi ngay tại chỗ.
    if (!emp.userId) return Promise.reject(new Error("employee-without-user"));
    const userId = emp.userId;
    setAttendees((prev) =>
      prev.some((a) => a.userId === userId)
        ? prev
        : [...prev, { userId, label: emp.fullName ?? emp.employeeCode ?? userId }],
    );
    return Promise.resolve();
  };

  const setOrganizerFrom = (emp: HrEmployeeListItem) => {
    if (!emp.userId) return Promise.reject(new Error("employee-without-user"));
    setOrganizer({ userId: emp.userId, label: emp.fullName ?? emp.employeeCode ?? emp.userId });
    return Promise.resolve();
  };

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        title={t("form.title")}
        footer={
          <>
            <Button variant="outline" onClick={onClose}>
              {t("form.cancel")}
            </Button>
            <Button disabled={!canSubmit} onClick={() => createMutation.mutate(idempotencyKey)}>
              {createMutation.isPending ? t("form.submitting") : t("form.submit")}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <label className="block text-sm">
            <span className="mb-1 block font-medium">{t("form.room")}</span>
            <Select value={roomId} onChange={(e) => setRoomId(e.target.value)}>
              <option value="">{t("form.roomPlaceholder")}</option>
              {bookableRooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} · {t("calendar.capacityUnit", { count: r.capacity })}
                </option>
              ))}
            </Select>
            {bookableRooms.length === 0 && (
              <span className="mt-1 block text-xs text-muted-foreground">
                {t("form.noBookableRoom")}
              </span>
            )}
          </label>

          <label className="block text-sm">
            <span className="mb-1 block font-medium">{t("form.subject")}</span>
            <Input
              value={title}
              maxLength={ROOM_BOOKING_TITLE_MAX}
              onChange={(e) => setTitle(e.target.value)}
            />
            {/* SPEC-14 §18: tiêu đề lượt đặt là dữ liệu dùng chung toàn công ty — người dùng phải
                biết trước khi gõ, không phải phát hiện sau khi lịch đã hiện cho mọi người. */}
            <span className="mt-1 block text-xs text-muted-foreground">
              {t("form.subjectHint")}
            </span>
          </label>

          <div className="grid grid-cols-3 gap-3">
            <label className="block text-sm">
              <span className="mb-1 block font-medium">{t("form.date")}</span>
              <Input type="date" value={localDate} onChange={(e) => setLocalDate(e.target.value)} />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">{t("form.startsAt")}</span>
              <Select value={startTime} onChange={(e) => setStartTime(e.target.value)}>
                {slots.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">{t("form.endsAt")}</span>
              <Select value={endTime} onChange={(e) => setEndTime(e.target.value)}>
                {slots.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            </label>
          </div>

          <div className="text-sm">
            <div className="mb-1 flex items-center justify-between">
              <span className="font-medium">{t("form.attendees")}</span>
              <Button variant="outline" size="sm" onClick={() => setPickerOpen("attendees")}>
                +
              </Button>
            </div>
            {attendees.length > 0 && (
              <ul className="flex flex-wrap gap-2">
                {attendees.map((a) => (
                  <li
                    key={a.userId}
                    className="flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs"
                  >
                    {a.label}
                    <button
                      type="button"
                      aria-label={`remove-${a.userId}`}
                      onClick={() =>
                        setAttendees((prev) => prev.filter((x) => x.userId !== a.userId))
                      }
                    >
                      <X className="size-3" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <span className="mt-1 block text-xs text-muted-foreground">
              {t("form.attendeesHint", { max: ROOM_MAX_ATTENDEES })}
            </span>
            {selectedRoom && (
              <span
                className={`mt-1 block text-xs ${overCapacity ? "text-danger" : "text-muted-foreground"}`}
              >
                {t("form.headcount", {
                  headcount: headcountOf(attendees.length),
                  capacity: selectedRoom.capacity,
                })}
              </span>
            )}
          </div>

          <div className="text-sm">
            <div className="mb-1 flex items-center justify-between">
              <span className="font-medium">{t("form.onBehalf")}</span>
              <Button variant="outline" size="sm" onClick={() => setPickerOpen("organizer")}>
                {organizer?.label ?? "+"}
              </Button>
            </div>
            <span className="text-xs text-muted-foreground">{t("form.onBehalfHint")}</span>
          </div>

          {clientConflicts.length > 0 && serverConflicts === null && (
            <div
              role="status"
              className="rounded-md border border-warning/40 bg-warning-muted px-3 py-2 text-sm text-warning"
            >
              <p>{t("form.conflictWarning")}</p>
              <ul className="mt-1 list-disc pl-4">
                {clientConflicts.map((b) => (
                  <li key={b.id}>
                    {localTimeOf(new Date(b.startsAt), timeZone)}–
                    {localTimeOf(new Date(b.endsAt), timeZone)} · {b.title}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="rounded-md border border-danger/40 bg-danger-muted px-3 py-2 text-sm text-danger"
            >
              <p>{error}</p>
              {serverConflicts && serverConflicts.conflicts.length > 0 && (
                <>
                  <p className="mt-1 font-medium">{t("form.conflictList")}</p>
                  <ul className="list-disc pl-4">
                    {serverConflicts.conflicts.map((c) => (
                      <li key={c.bookingId}>
                        {localTimeOf(new Date(c.startsAt), timeZone)}–
                        {localTimeOf(new Date(c.endsAt), timeZone)} · {c.title}
                        {c.organizerName ? ` · ${c.organizerName}` : ""}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {serverConflicts && (
                <p className="mt-1">
                  {serverConflicts.nextFreeFrom
                    ? t("form.nextFreeFrom", {
                        time: localTimeOf(new Date(serverConflicts.nextFreeFrom), timeZone),
                      })
                    : t("form.nextFreeNone")}
                </p>
              )}
            </div>
          )}
        </div>
      </Dialog>

      {pickerOpen !== null && (
        <EmployeeMultiPickerDialog
          title={pickerOpen === "attendees" ? t("form.attendees") : t("form.onBehalf")}
          selectionMode={pickerOpen === "attendees" ? "multi" : "single"}
          isRowDisabled={(emp) =>
            emp.userId === null ||
            (pickerOpen === "attendees" && attendees.some((a) => a.userId === emp.userId))
          }
          disabledBadge={(emp) =>
            emp.userId === null ? t("form.noAccount") : t("form.alreadyPicked")
          }
          onAddOne={pickerOpen === "attendees" ? addAttendee : setOrganizerFrom}
          onBatchSettled={() => undefined}
          onClose={() => setPickerOpen(null)}
        />
      )}
    </>
  );
}
