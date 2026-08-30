import { Injectable } from "@nestjs/common";
import { and, asc, eq, gte, ilike, isNull, or, sql, type SQL } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";
import { meetingRooms, type MeetingRoom, type NewMeetingRoom } from "../db/schema/rooms";
import { type PageInput, toOffset } from "./rooms.types";

export interface RoomListFilter {
  includeInactive: boolean;
  capacityMin?: number;
  q?: string;
  sort: "sortOrder" | "name";
}

export interface RoomAvailabilityFilter {
  from: Date;
  to: Date;
  capacityMin?: number;
  equipment?: readonly string[];
}

export interface RoomUsageRow {
  roomId: string;
  name: string;
  bookingsCount: number;
  hoursBooked: number;
  cancelledCount: number;
}

/** Cột được PATCH — KHÔNG `id`/`companyId`/`created_*`/`deleted_*` (xoá mềm đi đường riêng). */
export type RoomPatch = Partial<
  Pick<
    NewMeetingRoom,
    | "name"
    | "location"
    | "capacity"
    | "equipment"
    | "description"
    | "requiresApproval"
    | "isActive"
    | "sortOrder"
  >
>;

/**
 * S11-ROOM-BE-1 — RoomsRepository: `meeting_rooms` (tái dụng — DB-16 §6.1). Chạy TRONG `withTenant` do service mở;
 * `company_id` ở MỌI câu (BẤT BIẾN #1). Xoá mềm = UPDATE `deleted_at` (BẤT BIẾN #2 — app role KHÔNG DELETE).
 *
 * `lockByIdTx` = `SELECT … FOR UPDATE` (SPEC-14 §13.2 bước 2): đặt phòng ‖ vô hiệu/xoá phòng ‖ đặt khác cùng phòng
 * tuần tự hoá trên hàng phòng — app role có UPDATE cấp bảng trên `meeting_rooms` (0552) nên FOR UPDATE hợp lệ.
 */
@Injectable()
export class RoomsRepository {
  private alive(companyId: string): SQL[] {
    return [eq(meetingRooms.companyId, companyId), isNull(meetingRooms.deletedAt)];
  }

  async listTx(
    tx: TenantTx,
    companyId: string,
    filter: RoomListFilter,
    page: PageInput,
  ): Promise<{ rows: MeetingRoom[]; total: number }> {
    const conds: SQL[] = [...this.alive(companyId)];
    if (!filter.includeInactive) conds.push(eq(meetingRooms.isActive, true));
    if (filter.capacityMin !== undefined)
      conds.push(gte(meetingRooms.capacity, filter.capacityMin));
    if (filter.q) {
      const pat = `%${filter.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
      conds.push(or(ilike(meetingRooms.name, pat), ilike(meetingRooms.location, pat))!);
    }
    const where = and(...conds);
    const order =
      filter.sort === "name"
        ? [asc(meetingRooms.name), asc(meetingRooms.sortOrder)]
        : [asc(meetingRooms.sortOrder), asc(meetingRooms.name)];
    const [rows, [{ n }]] = await Promise.all([
      tx
        .select()
        .from(meetingRooms)
        .where(where)
        .orderBy(...order)
        .limit(page.perPage)
        .offset(toOffset(page)),
      tx
        .select({ n: sql<number>`count(*)::int` })
        .from(meetingRooms)
        .where(where),
    ]);
    return { rows, total: n };
  }

  /** Phòng còn sống trong company (KHÔNG lấy đã xoá mềm) — 005/006/007/010. */
  async findAliveByIdTx(
    tx: TenantTx,
    companyId: string,
    id: string,
  ): Promise<MeetingRoom | undefined> {
    const [row] = await tx
      .select()
      .from(meetingRooms)
      .where(and(eq(meetingRooms.id, id), ...this.alive(companyId)))
      .limit(1);
    return row;
  }

  /** Phòng KỂ CẢ đã xoá mềm — lịch sử (008) và JOIN chi tiết lượt cũ (SPEC-14 §12: "vẫn hiện trong lịch sử"). */
  async findAnyByIdTx(
    tx: TenantTx,
    companyId: string,
    id: string,
  ): Promise<MeetingRoom | undefined> {
    const [row] = await tx
      .select()
      .from(meetingRooms)
      .where(and(eq(meetingRooms.id, id), eq(meetingRooms.companyId, companyId)))
      .limit(1);
    return row;
  }

  /** `SELECT … FOR UPDATE` hàng phòng còn sống — khoá tuần tự hoá đặt/vô hiệu/xoá (SPEC-14 §13.2 bước 2). */
  async lockAliveByIdTx(
    tx: TenantTx,
    companyId: string,
    id: string,
  ): Promise<MeetingRoom | undefined> {
    const [row] = await tx
      .select()
      .from(meetingRooms)
      .where(and(eq(meetingRooms.id, id), ...this.alive(companyId)))
      .limit(1)
      .for("update");
    return row;
  }

  async insertTx(tx: TenantTx, values: NewMeetingRoom): Promise<MeetingRoom> {
    const [row] = await tx.insert(meetingRooms).values(values).returning();
    return row;
  }

  async updateTx(
    tx: TenantTx,
    companyId: string,
    id: string,
    patch: RoomPatch,
    actorUserId: string,
  ): Promise<MeetingRoom | undefined> {
    const [row] = await tx
      .update(meetingRooms)
      .set({ ...patch, updatedAt: sql`now()`, updatedBy: actorUserId })
      .where(and(eq(meetingRooms.id, id), ...this.alive(companyId)))
      .returning();
    return row;
  }

  async softDeleteTx(
    tx: TenantTx,
    companyId: string,
    id: string,
    actorUserId: string,
  ): Promise<MeetingRoom | undefined> {
    const [row] = await tx
      .update(meetingRooms)
      .set({
        deletedAt: sql`now()`,
        deletedBy: actorUserId,
        updatedAt: sql`now()`,
        updatedBy: actorUserId,
      })
      .where(and(eq(meetingRooms.id, id), ...this.alive(companyId)))
      .returning();
    return row;
  }

  /** Lượt `Confirmed` có `ends_at > now()` của phòng — `upcomingCount` (005) + chốt ROOM-ERR-008 (006/007). */
  async countUpcomingTx(tx: TenantTx, companyId: string, roomId: string): Promise<number> {
    const res = await tx.execute(sql`
      select count(*)::int as n
        from room_bookings
       where company_id = ${companyId} and room_id = ${roomId}
         and status = 'Confirmed' and ends_at > now()
    `);
    return (res.rows as unknown as Array<{ n: number }>)[0]?.n ?? 0;
  }

  /**
   * Phòng trống (003 — SPEC-14 §13.4): sống, `is_active`, KHÔNG `requires_approval`, đủ sức chứa, chứa MỌI thiết bị
   * yêu cầu (`@>`), và NOT EXISTS lượt `Confirmed` giao `[from, to)`. Vị từ EXISTS viết định danh chữ (bảng chính
   * không alias) — không nội suy cột typed vào subquery tương quan.
   */
  async availabilityTx(
    tx: TenantTx,
    companyId: string,
    f: RoomAvailabilityFilter,
  ): Promise<MeetingRoom[]> {
    const conds: SQL[] = [
      ...this.alive(companyId),
      eq(meetingRooms.isActive, true),
      eq(meetingRooms.requiresApproval, false),
      sql`not exists (
        select 1 from room_bookings b
         where b.company_id = ${companyId}
           and b.room_id = meeting_rooms.id
           and b.status = 'Confirmed'
           and tstzrange(b.starts_at, b.ends_at, '[)') && tstzrange(${f.from}::timestamptz, ${f.to}::timestamptz, '[)')
      )`,
    ];
    if (f.capacityMin !== undefined) conds.push(gte(meetingRooms.capacity, f.capacityMin));
    if (f.equipment && f.equipment.length > 0) {
      conds.push(sql`${meetingRooms.equipment} @> ${sql.param([...f.equipment])}::text[]`);
    }
    return tx
      .select()
      .from(meetingRooms)
      .where(and(...conds))
      .orderBy(asc(meetingRooms.sortOrder), asc(meetingRooms.name));
  }

  /**
   * Thống kê sử dụng (004): theo phòng, chỉ lượt có `starts_at ∈ [from, to)`; gồm phòng vô hiệu/xoá mềm NẾU có lượt
   * (HAVING); phòng sống + active không có lượt vẫn hiện với số 0. `hoursBooked` chỉ Confirmed, làm tròn 2 chữ số.
   */
  async usageSummaryTx(
    tx: TenantTx,
    companyId: string,
    from: Date,
    to: Date,
  ): Promise<RoomUsageRow[]> {
    const res = await tx.execute(sql`
      select r.id as "roomId", r.name,
             count(b.id) filter (where b.status = 'Confirmed')::int as "bookingsCount",
             coalesce(round((sum(extract(epoch from (b.ends_at - b.starts_at))) filter (where b.status = 'Confirmed') / 3600.0)::numeric, 2), 0)::float8 as "hoursBooked",
             count(b.id) filter (where b.status = 'Cancelled')::int as "cancelledCount"
        from meeting_rooms r
        left join room_bookings b
          on b.room_id = r.id and b.company_id = ${companyId}
         and b.starts_at >= ${from}::timestamptz and b.starts_at < ${to}::timestamptz
       where r.company_id = ${companyId}
       group by r.id, r.name, r.deleted_at, r.is_active, r.sort_order
      having count(b.id) > 0 or (r.deleted_at is null and r.is_active)
       order by r.sort_order asc, r.name asc
    `);
    return res.rows as unknown as RoomUsageRow[];
  }
}
