import { Injectable, Logger } from "@nestjs/common";
import {
  ROOM_CONFLICTS_MAX,
  ROOM_MAX_ATTENDEES,
  ROOM_WINDOW_MAX_DAYS,
  type CancelRoomBookingDto,
  type CreateRoomBookingDto,
  type ListRoomBookingsQueryDto,
  type MyRoomBookingResponseDto,
  type MyRoomBookingsQueryDto,
  type RoomBookingResponseDto,
} from "@mediaos/contracts";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import { OutboxService } from "../events/outbox.service";
import { RoomAccessService } from "./room-access.service";
import { RoomBookingsRepository, type RoomBookingRow } from "./room-bookings.repository";
import {
  ROOM_EVENT_CANCELLED,
  ROOM_EVENT_CONFIRMED,
  roomBookingCancelledPayload,
  roomBookingConfirmedPayload,
} from "./room-noti.payload";
import { RoomPeopleRepository } from "./room-people.repository";
import {
  DAY_MS,
  bookingWindowViolation,
  companyDayBounds,
  computeNextFreeFrom,
  formatTimeRange,
  lookupWindowViolation,
} from "./room-time";
import {
  ROOM_ERR,
  ROOM_ERR_CODE,
  attendeeError,
  bookOnBehalfDenied,
  cancelScopeDenied,
  conflict,
  isOverlapExclusion,
  mapRoomPgError,
  notFoundBooking,
  notFoundRoom,
  overlapError,
  roomDetails,
  unprocessable,
  windowError,
} from "./rooms.errors";
import { collectPeopleIds, toBookingDto, toConflictDto, toMyBookingDto } from "./rooms.mapper";
import { RoomsRepository } from "./rooms.repository";
import type { RoomActor, RoomRequestUser } from "./rooms.types";

/** CHECK cặp huỷ bảo đảm `cancelled_at` không null sau `cancelTx`; null ⇒ vi phạm bất biến, NÉM (gate L1, không ép kiểu). */
function cancelledAtOf(row: { id: string; cancelledAt: Date | null }): Date {
  if (!row.cancelledAt)
    throw new Error(`ROOM: booking ${row.id} Cancelled nhưng cancelled_at NULL`);
  return new Date(row.cancelledAt);
}

/** Tiêu đề thay thế trong `conflicts[]` khi actor không có `view@Company` (SPEC-14 §12 ROOM-ERR-001). */
export const CONFLICT_TITLE_MASKED = "(đã có lịch)";

interface BookingSlot {
  roomId: string;
  startsAt: Date;
  endsAt: Date;
}

/**
 * S11-ROOM-BE-1 — RoomBookingsService: ROOM-API-009..013 (lịch · đặt · chi tiết · huỷ · của tôi).
 *
 * ĐẶT (SPEC-14 §13.2) — thứ tự kiểm CỐ ĐỊNH: giờ → phòng (`FOR UPDATE`) → organizer → attendees → sức chứa → trùng
 * lịch (kiểm-trước, 409 có nội dung) → INSERT + attendees + audit + outbox trong MỘT tx. Chốt cuối = EXCLUDE
 * `room_bookings_no_overlap_excl` (23P01): **KHÔNG try/catch bên trong `withTenant`** (tx đã abort ⇒ 25P02) — bắt ở
 * NGOÀI, mở `withTenant` THỨ HAI chỉ SELECT để dựng cùng một 409 ROOM-ERR-001 (plan §1.1.4).
 *
 * HUỶ (§13.3) — quyền TRƯỚC trạng thái: pre-read chỉ để quyết 403 scope; `cancelTx` là MỘT câu UPDATE atomic; 0 hàng ⇒
 * đọc LẠI trong cùng tx để chọn kind ROOM-ERR-005 (không dùng ảnh chụp cũ — race 2 huỷ trả `already-cancelled`).
 *
 * Data scope ép ở service: `book@Own` ⇒ organizer = caller; `cancel@Own` ⇒ organizer = caller (403); cross-tenant ⇒ 404.
 * Tên người: MỘT điểm chiếu (`RoomPeopleRepository.namesByUserIdsTx`) gác bởi `view` scope (plan-review B1).
 */
@Injectable()
export class RoomBookingsService {
  private readonly logger = new Logger(RoomBookingsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly access: RoomAccessService,
    private readonly rooms: RoomsRepository,
    private readonly bookings: RoomBookingsRepository,
    private readonly people: RoomPeopleRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  /** 009 — lịch mọi phòng trong cửa sổ ≤ 31 ngày, phẳng. */
  async list(
    user: RoomRequestUser,
    q: ListRoomBookingsQueryDto,
  ): Promise<RoomBookingResponseDto[]> {
    const actor = await this.access.resolveViewActor(user);
    const from = new Date(q.from);
    const to = new Date(q.to);
    const kind = lookupWindowViolation(from, to, ROOM_WINDOW_MAX_DAYS);
    if (kind) throw windowError(kind);
    return this.db.withTenant(user.companyId, async (tx) => {
      const rows = await this.bookings.listWindowTx(tx, user.companyId, {
        from,
        to,
        status: q.status,
        roomIds: q.roomId,
        organizerUserId: q.organizerUserId,
      });
      return this.hydrate(tx, actor, rows);
    });
  }

  /** 011 — chi tiết; không thuộc company ⇒ 404 (kể cả tenant khác). */
  async get(user: RoomRequestUser, id: string): Promise<RoomBookingResponseDto> {
    const actor = await this.access.resolveViewActor(user);
    return this.db.withTenant(user.companyId, async (tx) => {
      const row = await this.bookings.findDetailTx(tx, user.companyId, id);
      if (!row) throw notFoundBooking();
      const [dto] = await this.hydrate(tx, actor, [row]);
      return dto;
    });
  }

  /** 013 — user từ token; `date` theo tz công ty HOẶC `from/to` ≤ 31 ngày; bộ lọc organizer/attendee = me. */
  async listMine(
    user: RoomRequestUser,
    q: MyRoomBookingsQueryDto,
  ): Promise<MyRoomBookingResponseDto[]> {
    const actor = await this.access.resolveViewActor(user);
    let explicit: { from: Date; to: Date } | null = null;
    if (q.from !== undefined && q.to !== undefined) {
      explicit = { from: new Date(q.from), to: new Date(q.to) };
      const kind = lookupWindowViolation(explicit.from, explicit.to, ROOM_WINDOW_MAX_DAYS);
      if (kind) throw windowError(kind);
    }
    return this.db.withTenant(user.companyId, async (tx) => {
      const window =
        explicit ??
        companyDayBounds(q.date as string, await this.people.companyTimezoneTx(tx, user.companyId));
      const rows = await this.bookings.listMineTx(tx, user.companyId, user.id, {
        from: window.from,
        to: window.to,
        role: q.role,
        includeCancelled: q.includeCancelled ?? false,
      });
      const attendees = await this.bookings.attendeesByBookingIdsTx(
        tx,
        user.companyId,
        rows.map((r) => r.id),
      );
      const people = await this.people.namesByUserIdsTx(
        tx,
        actor,
        collectPeopleIds(rows, attendees),
      );
      const ctx = {
        now: new Date(),
        actorUserId: actor.actorUserId,
        cancelScope: actor.cancelScope,
      };
      return rows.map((r) => toMyBookingDto(r, attendees.get(r.id) ?? [], people, ctx));
    });
  }

  /** 010 — đặt phòng (SPEC-14 §13.2). `@Idempotent()` ở controller; Idempotency-Key do FE sinh. */
  async create(user: RoomRequestUser, dto: CreateRoomBookingDto): Promise<RoomBookingResponseDto> {
    const actor = await this.access.resolveBookActor(user);
    const now = new Date();
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    const windowKind = bookingWindowViolation(startsAt, endsAt, now);
    if (windowKind) throw windowError(windowKind);

    const organizerId = dto.organizerUserId ?? user.id;
    if (organizerId !== user.id && !actor.isCompanyWrite) throw bookOnBehalfDenied();

    const attendees = dto.attendeeUserIds ?? [];
    if (new Set(attendees).size !== attendees.length || attendees.includes(organizerId)) {
      throw attendeeError("attendee-duplicate");
    }
    if (attendees.length > ROOM_MAX_ATTENDEES) throw attendeeError("too-many-attendees");

    const slot: BookingSlot = { roomId: dto.roomId, startsAt, endsAt };
    let roomName = "";
    try {
      return await this.db.withTenant(user.companyId, async (tx) => {
        // (2) Phòng — FOR UPDATE tuần tự hoá với vô hiệu/xoá phòng và với lượt đặt khác cùng phòng.
        // tz đọc TRƯỚC khi khoá phòng (database gate M2 — rút ngắn thời gian giữ FOR UPDATE).
        const tz = await this.people.companyTimezoneTx(tx, user.companyId);
        const room = await this.rooms.lockAliveByIdTx(tx, user.companyId, dto.roomId);
        if (!room) throw notFoundRoom();
        roomName = room.name;
        if (!room.isActive) {
          throw conflict(
            ROOM_ERR_CODE.ROOM_NOT_BOOKABLE,
            ROOM_ERR.ROOM_INACTIVE,
            roomDetails("room-inactive"),
          );
        }
        if (room.requiresApproval) {
          throw conflict(
            ROOM_ERR_CODE.ROOM_NOT_BOOKABLE,
            ROOM_ERR.APPROVAL_NOT_SUPPORTED,
            roomDetails("approval-not-supported"),
          );
        }
        // (3)+(4) Organizer + attendees — MỘT câu; thiếu = không tồn tại/khác tenant/xoá mềm (không oracle).
        const statuses = await this.people.userStatusesTx(tx, user.companyId, [
          organizerId,
          ...attendees,
        ]);
        const orgStatus = statuses.get(organizerId);
        if (orgStatus === undefined) {
          throw unprocessable(
            ROOM_ERR_CODE.ORGANIZER,
            ROOM_ERR.ORGANIZER_NOT_FOUND,
            roomDetails("organizer-not-found"),
          );
        }
        if (orgStatus !== "active") {
          throw unprocessable(
            ROOM_ERR_CODE.ORGANIZER,
            ROOM_ERR.ORGANIZER_INACTIVE,
            roomDetails("organizer-inactive"),
          );
        }
        for (const a of attendees) {
          const st = statuses.get(a);
          if (st === undefined) throw attendeeError("attendee-not-found", a);
          if (st !== "active") throw attendeeError("attendee-inactive", a);
        }
        // (5) Sức chứa — organizer ngầm định là người tham dự.
        const headcount = 1 + attendees.length;
        if (headcount > room.capacity) {
          throw unprocessable(
            ROOM_ERR_CODE.CAPACITY,
            ROOM_ERR.CAPACITY(room.capacity, headcount),
            roomDetails("over-capacity", { capacity: room.capacity, headcount }),
          );
        }
        // (6) Kiểm trùng trước — tx còn sống nên dựng 409 có nội dung ngay tại đây.
        const overlaps = await this.bookings.findOverlapsTx(
          tx,
          user.companyId,
          room.id,
          startsAt,
          endsAt,
        );
        if (overlaps.length > 0)
          throw await this.buildOverlapError(tx, actor, room.name, slot, overlaps);
        // (7) INSERT — KHÔNG try/catch ở đây: 23P01 nổi lên ngoài `withTenant` (plan §1.1.4).
        const row = await this.bookings.insertTx(tx, {
          companyId: user.companyId,
          roomId: room.id,
          title: dto.title,
          description: dto.description ?? null,
          startsAt,
          endsAt,
          organizerUserId: organizerId,
          bookedByUserId: user.id,
          updatedBy: user.id,
        });
        await this.bookings.insertAttendeesTx(tx, user.companyId, row.id, attendees);
        await this.audit.record(tx, {
          action: "book",
          objectType: "room_booking",
          objectId: row.id,
          actorUserId: user.id,
          after: {
            id: row.id,
            roomId: room.id,
            organizerUserId: organizerId,
            bookedByUserId: user.id,
            startsAt: startsAt.toISOString(),
            endsAt: endsAt.toISOString(),
            status: row.status,
            attendeeCount: attendees.length,
          },
        });
        const detail = await this.bookings.findDetailTx(tx, user.companyId, row.id);
        // Vừa INSERT trong CÙNG tx ⇒ không thấy là vi phạm bất biến (JOIN meeting_rooms/RLS) — 500 có stack, không 404 câm.
        if (!detail) {
          throw new Error(
            `ROOM: booking ${row.id} vừa INSERT nhưng findDetailTx không thấy — kiểm JOIN meeting_rooms/RLS`,
          );
        }
        const people = await this.people.namesByUserIdsTx(
          tx,
          actor,
          collectPeopleIds([detail], new Map([[row.id, attendees]])),
        );
        await this.outbox.enqueue(tx, {
          eventType: ROOM_EVENT_CONFIRMED,
          payload: roomBookingConfirmedPayload(
            {
              bookingId: row.id,
              actorUserId: user.id,
              roomName: room.name,
              title: row.title,
              timeRange: formatTimeRange(startsAt, endsAt, tz),
            },
            people.get(organizerId)?.displayName ?? null,
          ),
        });
        return toBookingDto(detail, attendees, people, {
          now,
          actorUserId: actor.actorUserId,
          cancelScope: actor.cancelScope,
        });
      });
    } catch (err) {
      if (!isOverlapExclusion(err)) {
        const mapped = mapRoomPgError(err);
        if (!mapped) {
          // Lỗi PG/khác ngoài hợp đồng ⇒ ném nguyên bản (filter ⇒ 500) — để vết ở đây cho điều tra (gate M5).
          this.logger.error(
            `ROOM create room=${dto.roomId} actor=${user.id}: lỗi ngoài hợp đồng — ${err instanceof Error ? err.message : String(err)}`,
          );
          throw err;
        }
        throw mapped;
      }
      // Đường EXCLUDE (23P01): kiểm-trước trượt dù đã FOR UPDATE ⇒ có writer ngoài service (bất thường vận hành) — LOG.
      // tx thứ nhất đã rollback; mở tx MỚI chỉ để SELECT rồi ném cùng 409 ROOM-ERR-001.
      this.logger.warn(
        `ROOM create: EXCLUDE 23P01 sau kiểm-trước — room=${dto.roomId} startsAt=${startsAt.toISOString()} actor=${user.id}`,
      );
      throw await this.db.withTenant(user.companyId, async (tx) => {
        const overlaps = await this.bookings.findOverlapsTx(
          tx,
          user.companyId,
          dto.roomId,
          startsAt,
          endsAt,
        );
        if (overlaps.length === 0) {
          // Lượt chặn biến mất giữa hai tx (huỷ xen giữa) ⇒ KHÔNG gợi ý chính startsAt (FE lặp vô hạn): 409 conflicts
          // rỗng + nextFreeFrom null để FE thử lại (gate M2).
          this.logger.warn(
            `ROOM create: 23P01 nhưng findOverlapsTx trống — room=${dto.roomId} (transient)`,
          );
          return overlapError(roomName || "?", [], null);
        }
        return this.buildOverlapError(tx, actor, roomName || "?", slot, overlaps);
      });
    }
  }

  /** 012 — huỷ (SPEC-14 §13.3). */
  async cancel(
    user: RoomRequestUser,
    id: string,
    dto: CancelRoomBookingDto,
  ): Promise<RoomBookingResponseDto> {
    const actor = await this.access.resolveCancelActor(user);
    const now = new Date();
    return this.db.withTenant(user.companyId, async (tx) => {
      const cur = await this.bookings.findStatusTx(tx, user.companyId, id);
      if (!cur) throw notFoundBooking();
      // Quyền TRƯỚC trạng thái (lịch công khai trong company ⇒ 403, không 404).
      if (!actor.isCompanyWrite && cur.organizerUserId !== user.id) throw cancelScopeDenied();
      const updated = await this.bookings.cancelTx(
        tx,
        user.companyId,
        id,
        user.id,
        dto.reason ?? null,
      );
      if (!updated) {
        const again = await this.bookings.findStatusTx(tx, user.companyId, id);
        if (!again) throw notFoundBooking();
        if (again.status === "Cancelled") {
          throw conflict(
            ROOM_ERR_CODE.CANCEL,
            ROOM_ERR.ALREADY_CANCELLED,
            roomDetails("already-cancelled"),
          );
        }
        throw conflict(ROOM_ERR_CODE.CANCEL, ROOM_ERR.ALREADY_ENDED, roomDetails("already-ended"));
      }
      await this.audit.record(tx, {
        action: "cancel",
        objectType: "room_booking",
        objectId: id,
        actorUserId: user.id,
        before: {
          status: "Confirmed",
          startsAt: new Date(cur.startsAt).toISOString(),
          endsAt: new Date(cur.endsAt).toISOString(),
        },
        after: {
          status: "Cancelled",
          cancelledAt: cancelledAtOf(updated).toISOString(),
          cancelledBy: user.id,
          cancelReason: updated.cancelReason ?? null,
        },
      });
      const detail = await this.bookings.findDetailTx(tx, user.companyId, id);
      if (!detail)
        throw new Error(`ROOM: booking ${id} vừa UPDATE (cancel) nhưng findDetailTx không thấy`);
      const attendees = await this.bookings.attendeesByBookingIdsTx(tx, user.companyId, [id]);
      const people = await this.people.namesByUserIdsTx(
        tx,
        actor,
        collectPeopleIds([detail], attendees),
      );
      const tz = await this.people.companyTimezoneTx(tx, user.companyId);
      await this.outbox.enqueue(tx, {
        eventType: ROOM_EVENT_CANCELLED,
        payload: roomBookingCancelledPayload(
          {
            bookingId: id,
            actorUserId: user.id,
            roomName: detail.roomName,
            title: detail.title,
            timeRange: formatTimeRange(new Date(detail.startsAt), new Date(detail.endsAt), tz),
          },
          people.get(user.id)?.displayName ?? null,
        ),
      });
      return toBookingDto(detail, attendees.get(id) ?? [], people, {
        now,
        actorUserId: actor.actorUserId,
        cancelScope: actor.cancelScope,
      });
    });
  }

  /** Gắn attendees + tên người cho một tập lượt — MỘT câu attendees + MỘT lần chiếu tên. */
  private async hydrate(
    tx: TenantTx,
    actor: RoomActor,
    rows: RoomBookingRow[],
  ): Promise<RoomBookingResponseDto[]> {
    const attendees = await this.bookings.attendeesByBookingIdsTx(
      tx,
      actor.companyId,
      rows.map((r) => r.id),
    );
    const people = await this.people.namesByUserIdsTx(tx, actor, collectPeopleIds(rows, attendees));
    const ctx = { now: new Date(), actorUserId: actor.actorUserId, cancelScope: actor.cancelScope };
    return rows.map((r) => toBookingDto(r, attendees.get(r.id) ?? [], people, ctx));
  }

  /** 409 ROOM-ERR-001 với `conflicts[]` (≤ 20, tên organizer theo scope danh tính) + `nextFreeFrom`. */
  private async buildOverlapError(
    tx: TenantTx,
    actor: RoomActor,
    roomName: string,
    slot: BookingSlot,
    overlaps: Awaited<ReturnType<RoomBookingsRepository["findOverlapsTx"]>>,
  ) {
    const capped = overlaps.slice(0, ROOM_CONFLICTS_MAX);
    const people = await this.people.namesByUserIdsTx(
      tx,
      actor,
      capped.map((o) => o.organizerUserId),
    );
    const day = await this.bookings.findDayBookingsTx(
      tx,
      actor.companyId,
      slot.roomId,
      slot.startsAt,
      new Date(slot.startsAt.getTime() + DAY_MS),
    );
    const nextFreeFrom = computeNextFreeFrom(
      slot.startsAt,
      slot.endsAt.getTime() - slot.startsAt.getTime(),
      day.map((d) => ({ startsAt: new Date(d.startsAt), endsAt: new Date(d.endsAt) })),
    );
    // Actor KHÔNG có `view@Company` (role tuỳ biến chỉ `book`) ⇒ tiêu đề lượt của người khác bị che (gate M3) —
    // cùng luật với tên người tổ chức; khung giờ vẫn trả (đó là điều cần biết để chọn giờ khác).
    const showTitle = RoomAccessService.isCompany(actor.viewScope);
    return overlapError(
      roomName,
      capped.map((o) => {
        const dto = toConflictDto(o, people);
        return showTitle ? dto : { ...dto, title: CONFLICT_TITLE_MASKED };
      }),
      nextFreeFrom,
    );
  }
}
