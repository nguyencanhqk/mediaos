import { Injectable } from "@nestjs/common";
import {
  ROOM_USAGE_WINDOW_MAX_DAYS,
  ROOM_WINDOW_MAX_DAYS,
  type CreateRoomDto,
  type ListRoomsQueryDto,
  type RoomAvailabilityItemDto,
  type RoomAvailabilityQueryDto,
  type RoomBookingResponseDto,
  type RoomBookingsWindowQueryDto,
  type RoomResponseDto,
  type RoomUsageSummaryItemDto,
  type RoomUsageSummaryQueryDto,
  type UpdateRoomDto,
} from "@mediaos/contracts";
import { paginated, toPagination, type PaginatedResult } from "../common/pagination";
import { DatabaseService, type TenantTx } from "../db/db.service";
import type { MeetingRoom } from "../db/schema/rooms";
import { AuditService } from "../events/audit.service";
import { RoomAccessService } from "./room-access.service";
import { RoomBookingsRepository } from "./room-bookings.repository";
import { RoomPeopleRepository } from "./room-people.repository";
import { availabilityWindowViolation, lookupWindowViolation } from "./room-time";
import {
  ROOM_ERR,
  ROOM_ERR_CODE,
  conflict,
  mapRoomPgError,
  notFoundRoom,
  roomDetails,
  windowError,
} from "./rooms.errors";
import {
  collectPeopleIds,
  toAvailabilityItemDto,
  toBookingDto,
  toRoomDto,
  toUsageSummaryItemDto,
} from "./rooms.mapper";
import { RoomsRepository, type RoomPatch } from "./rooms.repository";
import type { RoomActor, RoomRequestUser } from "./rooms.types";

/** Ảnh chụp audit của phòng — chỉ id + thuộc tính nghiệp vụ (SPEC-14 §12). */
function roomSnapshot(r: MeetingRoom) {
  return {
    id: r.id,
    name: r.name,
    location: r.location,
    capacity: r.capacity,
    equipment: r.equipment,
    requiresApproval: r.requiresApproval,
    isActive: r.isActive,
    sortOrder: r.sortOrder,
    deletedAt: r.deletedAt,
  };
}

/**
 * S11-ROOM-BE-1 — RoomsService: ROOM-API-001..008 (phòng họp + lịch một phòng). Data-scope: `manage@Company`
 * (chỉ company-admin/office-admin) cho 002/006/007; `view@Company` cho phần còn lại. Mọi truy vấn qua `withTenant`.
 *
 * Bẫy 25P02: lỗi DB (23505 tên phòng) được map Ở NGOÀI `withTenant` — không try/catch rồi tiếp tục trong tx đã abort.
 * Vô hiệu/xoá phòng khoá hàng phòng `FOR UPDATE` cùng khoá mà đặt phòng dùng ⇒ không thể vừa `is_active=false`
 * vừa nhận thêm lượt Confirmed tương lai (SPEC-14 §13.2 bước 2).
 */
@Injectable()
export class RoomsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: RoomAccessService,
    private readonly rooms: RoomsRepository,
    private readonly bookings: RoomBookingsRepository,
    private readonly people: RoomPeopleRepository,
    private readonly audit: AuditService,
  ) {}

  /** 001 */
  async list(
    user: RoomRequestUser,
    q: ListRoomsQueryDto,
  ): Promise<PaginatedResult<RoomResponseDto[]>> {
    await this.access.resolveViewActor(user);
    return this.db.withTenant(user.companyId, async (tx) => {
      const { rows, total } = await this.rooms.listTx(
        tx,
        user.companyId,
        {
          includeInactive: q.includeInactive ?? false,
          capacityMin: q.capacityMin,
          q: q.q,
          sort: q.sort,
        },
        { page: q.page, perPage: q.per_page },
      );
      return paginated(
        rows.map((r) => toRoomDto(r)),
        toPagination(total, q.page, q.per_page),
      );
    });
  }

  /** 003 — chỉ `end-before-start`/`too-long` (SPEC-14 §13.4). */
  async availability(
    user: RoomRequestUser,
    q: RoomAvailabilityQueryDto,
  ): Promise<RoomAvailabilityItemDto[]> {
    await this.access.resolveViewActor(user);
    const from = new Date(q.from);
    const to = new Date(q.to);
    const kind = availabilityWindowViolation(from, to);
    if (kind) throw windowError(kind);
    return this.db.withTenant(user.companyId, async (tx) => {
      const rows = await this.rooms.availabilityTx(tx, user.companyId, {
        from,
        to,
        capacityMin: q.capacityMin,
        equipment: q.equipment,
      });
      return rows.map(toAvailabilityItemDto);
    });
  }

  /** 004 — ≤ 366 ngày. */
  async usageSummary(
    user: RoomRequestUser,
    q: RoomUsageSummaryQueryDto,
  ): Promise<RoomUsageSummaryItemDto[]> {
    await this.access.resolveViewActor(user);
    const from = new Date(q.from);
    const to = new Date(q.to);
    const kind = lookupWindowViolation(from, to, ROOM_USAGE_WINDOW_MAX_DAYS);
    if (kind) throw windowError(kind);
    return this.db.withTenant(user.companyId, async (tx) => {
      const rows = await this.rooms.usageSummaryTx(tx, user.companyId, from, to);
      return rows.map(toUsageSummaryItemDto);
    });
  }

  /** 005 — phòng đã xoá mềm ⇒ 404. */
  async get(user: RoomRequestUser, id: string): Promise<RoomResponseDto> {
    await this.access.resolveViewActor(user);
    return this.db.withTenant(user.companyId, async (tx) => {
      const room = await this.rooms.findAliveByIdTx(tx, user.companyId, id);
      if (!room) throw notFoundRoom();
      const upcoming = await this.rooms.countUpcomingTx(tx, user.companyId, room.id);
      return toRoomDto(room, upcoming);
    });
  }

  /** 002 */
  async create(user: RoomRequestUser, dto: CreateRoomDto): Promise<RoomResponseDto> {
    await this.access.resolveManageActor(user);
    try {
      return await this.db.withTenant(user.companyId, async (tx) => {
        const row = await this.rooms.insertTx(tx, {
          companyId: user.companyId,
          name: dto.name,
          location: dto.location ?? null,
          capacity: dto.capacity,
          equipment: dto.equipment ?? [],
          description: dto.description ?? null,
          requiresApproval: dto.requiresApproval ?? false,
          sortOrder: dto.sortOrder ?? 0,
          createdBy: user.id,
          updatedBy: user.id,
        });
        await this.audit.record(tx, {
          action: "create",
          objectType: "meeting_room",
          objectId: row.id,
          actorUserId: user.id,
          after: roomSnapshot(row),
        });
        return toRoomDto(row);
      });
    } catch (err) {
      throw mapRoomPgError(err, { name: dto.name }) ?? err;
    }
  }

  /** 006 — `isActive:false` khi còn lượt sắp tới ⇒ 409 ROOM-ERR-008; tên trùng ⇒ 409 009. */
  async update(user: RoomRequestUser, id: string, dto: UpdateRoomDto): Promise<RoomResponseDto> {
    await this.access.resolveManageActor(user);
    try {
      return await this.db.withTenant(user.companyId, async (tx) => {
        const room = await this.rooms.lockAliveByIdTx(tx, user.companyId, id);
        if (!room) throw notFoundRoom();
        const deactivating = dto.isActive === false && room.isActive;
        if (deactivating) await this.assertNoUpcoming(tx, user.companyId, room.id);
        const patch: RoomPatch = {};
        if (dto.name !== undefined) patch.name = dto.name;
        if (dto.location !== undefined) patch.location = dto.location ?? null;
        if (dto.capacity !== undefined) patch.capacity = dto.capacity;
        if (dto.equipment !== undefined) patch.equipment = dto.equipment;
        if (dto.description !== undefined) patch.description = dto.description ?? null;
        if (dto.requiresApproval !== undefined) patch.requiresApproval = dto.requiresApproval;
        if (dto.isActive !== undefined) patch.isActive = dto.isActive;
        if (dto.sortOrder !== undefined) patch.sortOrder = dto.sortOrder;
        const updated = await this.rooms.updateTx(tx, user.companyId, room.id, patch, user.id);
        if (!updated) throw notFoundRoom();
        await this.audit.record(tx, {
          action: deactivating ? "deactivate" : "update",
          objectType: "meeting_room",
          objectId: room.id,
          actorUserId: user.id,
          before: roomSnapshot(room),
          after: roomSnapshot(updated),
        });
        return toRoomDto(updated);
      });
    } catch (err) {
      throw mapRoomPgError(err, { name: dto.name }) ?? err;
    }
  }

  /** 007 — xoá MỀM; còn lượt sắp tới ⇒ 409 ROOM-ERR-008. */
  async remove(user: RoomRequestUser, id: string): Promise<void> {
    await this.access.resolveManageActor(user);
    await this.db.withTenant(user.companyId, async (tx) => {
      const room = await this.rooms.lockAliveByIdTx(tx, user.companyId, id);
      if (!room) throw notFoundRoom();
      await this.assertNoUpcoming(tx, user.companyId, room.id);
      const deleted = await this.rooms.softDeleteTx(tx, user.companyId, room.id, user.id);
      if (!deleted) throw notFoundRoom();
      await this.audit.record(tx, {
        action: "delete",
        objectType: "meeting_room",
        objectId: room.id,
        actorUserId: user.id,
        before: roomSnapshot(room),
        after: roomSnapshot(deleted),
      });
    });
  }

  /** 008 — lịch + lịch sử một phòng; phòng đã xoá mềm VẪN trả; không có trong company ⇒ 404. */
  async bookingsOfRoom(
    user: RoomRequestUser,
    roomId: string,
    q: RoomBookingsWindowQueryDto,
  ): Promise<RoomBookingResponseDto[]> {
    const actor = await this.access.resolveViewActor(user);
    const from = new Date(q.from);
    const to = new Date(q.to);
    const kind = lookupWindowViolation(from, to, ROOM_WINDOW_MAX_DAYS);
    if (kind) throw windowError(kind);
    return this.db.withTenant(user.companyId, async (tx) => {
      const room = await this.rooms.findAnyByIdTx(tx, user.companyId, roomId);
      if (!room) throw notFoundRoom();
      const rows = await this.bookings.listWindowTx(tx, user.companyId, {
        from,
        to,
        status: q.status,
        roomIds: [room.id],
      });
      return this.hydrate(tx, actor, rows);
    });
  }

  /** Gắn attendees + tên người cho một tập lượt — MỘT câu attendees + MỘT lần chiếu tên. */
  async hydrate(
    tx: TenantTx,
    actor: RoomActor,
    rows: Awaited<ReturnType<RoomBookingsRepository["listWindowTx"]>>,
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

  private async assertNoUpcoming(tx: TenantTx, companyId: string, roomId: string): Promise<void> {
    const n = await this.rooms.countUpcomingTx(tx, companyId, roomId);
    if (n > 0) {
      throw conflict(
        ROOM_ERR_CODE.ROOM_HAS_UPCOMING,
        ROOM_ERR.ROOM_HAS_UPCOMING(n),
        roomDetails("room-has-upcoming", { upcomingCount: n }),
      );
    }
  }
}
