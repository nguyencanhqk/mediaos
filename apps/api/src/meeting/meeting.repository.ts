import { Injectable } from "@nestjs/common";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { DatabaseService, type TenantTx } from "../db/db.service";
import {
  meetingRooms,
  meetings,
  meetingAttendees,
  meetingNotes,
  meetingTasks,
} from "../db/schema/meeting";
import type {
  NewMeeting,
  NewMeetingRoom,
  NewMeetingAttendee,
  NewMeetingNote,
  NewMeetingTask,
} from "../db/schema/meeting";
import { tasks } from "../db/schema/workflow";

// ─── Row types returned to service ───────────────────────────────────────────

export interface MeetingRow {
  id: string;
  companyId: string;
  meetingRoomId: string | null;
  title: string;
  description: string | null;
  startsAt: Date;
  endsAt: Date;
  organizerId: string;
  status: string;
  agenda: unknown[];
  createdAt: Date;
  updatedAt: Date;
}

export interface MeetingRoomRow {
  id: string;
  companyId: string;
  name: string;
  location: string | null;
  capacity: number | null;
  isVirtual: boolean;
  createdAt: Date;
}

export interface MeetingNoteRow {
  id: string;
  meetingId: string;
  authorUserId: string;
  body: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface MeetingActionItemRow {
  taskId: string;
  title: string;
  status: string;
  taskType: string;
  assigneeUserId: string | null;
  dueDate: Date | null;
  linkedAt: Date;
}

const meetingRoomColumns = {
  id: meetingRooms.id,
  companyId: meetingRooms.companyId,
  name: meetingRooms.name,
  location: meetingRooms.location,
  capacity: meetingRooms.capacity,
  isVirtual: meetingRooms.isVirtual,
  createdAt: meetingRooms.createdAt,
} as const;

const meetingColumns = {
  id: meetings.id,
  companyId: meetings.companyId,
  meetingRoomId: meetings.meetingRoomId,
  title: meetings.title,
  description: meetings.description,
  startsAt: meetings.startsAt,
  endsAt: meetings.endsAt,
  organizerId: meetings.organizerId,
  status: meetings.status,
  agenda: meetings.agenda,
  createdAt: meetings.createdAt,
  updatedAt: meetings.updatedAt,
} as const;

@Injectable()
export class MeetingRepository {
  constructor(private readonly db: DatabaseService) {}

  // ─── MeetingRooms ─────────────────────────────────────────────────────────

  listRooms(companyId: string): Promise<MeetingRoomRow[]> {
    return this.db.withTenant(companyId, (tx) =>
      tx
        .select(meetingRoomColumns)
        .from(meetingRooms)
        .where(and(eq(meetingRooms.companyId, companyId), isNull(meetingRooms.deletedAt))),
    );
  }

  createRoom(
    companyId: string,
    data: Omit<NewMeetingRoom, "companyId">,
  ): Promise<MeetingRoomRow[]> {
    return this.db.withTenant(companyId, (tx) =>
      tx
        .insert(meetingRooms)
        .values({ ...data, companyId })
        .returning(meetingRoomColumns),
    );
  }

  updateRoom(
    companyId: string,
    roomId: string,
    data: Partial<Pick<NewMeetingRoom, "name" | "location" | "capacity" | "isVirtual">>,
  ): Promise<MeetingRoomRow[]> {
    return this.db.withTenant(companyId, (tx) =>
      tx
        .update(meetingRooms)
        .set(data)
        .where(
          and(
            eq(meetingRooms.companyId, companyId),
            eq(meetingRooms.id, roomId),
            isNull(meetingRooms.deletedAt),
          ),
        )
        .returning(meetingRoomColumns),
    );
  }

  softDeleteRoom(companyId: string, roomId: string): Promise<MeetingRoomRow[]> {
    return this.db.withTenant(companyId, (tx) =>
      tx
        .update(meetingRooms)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(meetingRooms.companyId, companyId),
            eq(meetingRooms.id, roomId),
            isNull(meetingRooms.deletedAt),
          ),
        )
        .returning(meetingRoomColumns),
    );
  }

  // ─── Meetings ─────────────────────────────────────────────────────────────

  listMeetings(companyId: string, organizerId?: string): Promise<MeetingRow[]> {
    return this.db.withTenant(companyId, (tx) => {
      const conditions = [
        eq(meetings.companyId, companyId),
        isNull(meetings.deletedAt),
        ...(organizerId ? [eq(meetings.organizerId, organizerId)] : []),
      ];
      return tx
        .select(meetingColumns)
        .from(meetings)
        .where(and(...conditions));
    });
  }

  findMeetingById(companyId: string, meetingId: string): Promise<MeetingRow[]> {
    return this.db.withTenant(companyId, (tx) =>
      tx
        .select(meetingColumns)
        .from(meetings)
        .where(
          and(
            eq(meetings.companyId, companyId),
            eq(meetings.id, meetingId),
            isNull(meetings.deletedAt),
          ),
        ),
    );
  }

  /**
   * createMeeting — INSERT trong transaction cấp trên (truyền vào tx).
   * Caller (MeetingService) mở withTenant một lần, truyền tx xuống để double-booking
   * check + INSERT + attendee seed đều trong cùng 1 transaction.
   */
  insertMeeting(tx: TenantTx, data: NewMeeting): Promise<MeetingRow[]> {
    return tx.insert(meetings).values(data).returning(meetingColumns);
  }

  updateMeeting(
    companyId: string,
    meetingId: string,
    data: Partial<
      Pick<
        NewMeeting,
        "title" | "description" | "meetingRoomId" | "startsAt" | "endsAt" | "status" | "agenda"
      >
    >,
  ): Promise<MeetingRow[]> {
    return this.db.withTenant(companyId, (tx) =>
      tx
        .update(meetings)
        .set({ ...data, updatedAt: new Date() })
        .where(
          and(
            eq(meetings.companyId, companyId),
            eq(meetings.id, meetingId),
            isNull(meetings.deletedAt),
          ),
        )
        .returning(meetingColumns),
    );
  }

  /** Soft-cancel: set status='cancelled' + deleted_at. */
  cancelMeeting(companyId: string, meetingId: string): Promise<MeetingRow[]> {
    return this.db.withTenant(companyId, (tx) =>
      tx
        .update(meetings)
        .set({ status: "cancelled", deletedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(meetings.companyId, companyId),
            eq(meetings.id, meetingId),
            isNull(meetings.deletedAt),
          ),
        )
        .returning(meetingColumns),
    );
  }

  /**
   * checkDoubleBooking — đếm meeting hiện tại của cùng phòng có overlap với [startsAt, endsAt).
   * Dùng ở service để báo lỗi rõ ràng TRƯỚC khi INSERT (DB cũng có EXCLUDE constraint làm lớp 2).
   * companyId: explicit predicate tường minh — KHÔNG chỉ dựa RLS session setting.
   *   - Cùng tenant: 2 meeting cùng room trùng giờ → bị từ chối.
   *   - Cross-tenant: room trùng tên/khác company → company_id khác → KHÔNG coi là đụng nhau.
   * excludeMeetingId: dùng khi UPDATE (bỏ qua chính nó).
   * Trả về mảng row (rows[0].count).
   */
  async checkDoubleBooking(
    tx: TenantTx,
    companyId: string,
    roomId: string,
    startsAt: Date,
    endsAt: Date,
    excludeMeetingId?: string,
  ): Promise<{ count: number }[]> {
    const excludeClause = excludeMeetingId ? sql`AND id != ${excludeMeetingId}` : sql``;

    const result = await tx.execute<{ count: number }>(sql`
      SELECT COUNT(*)::int AS count
      FROM meetings
      WHERE company_id = ${companyId}::uuid
        AND meeting_room_id = ${roomId}
        AND deleted_at IS NULL
        AND status != 'cancelled'
        AND tstzrange(starts_at, ends_at, '[)') && tstzrange(${startsAt.toISOString()}::timestamptz, ${endsAt.toISOString()}::timestamptz, '[)')
        ${excludeClause}
    `);
    return result.rows as { count: number }[];
  }

  // ─── Attendees ────────────────────────────────────────────────────────────

  listAttendees(companyId: string, meetingId: string) {
    return this.db.withTenant(companyId, (tx) =>
      tx
        .select()
        .from(meetingAttendees)
        .where(
          and(eq(meetingAttendees.companyId, companyId), eq(meetingAttendees.meetingId, meetingId)),
        ),
    );
  }

  insertAttendees(tx: TenantTx, rows: NewMeetingAttendee[]): Promise<unknown[]> {
    if (rows.length === 0) return Promise.resolve([]);
    return tx.insert(meetingAttendees).values(rows).onConflictDoNothing().returning();
  }

  updateRsvp(companyId: string, meetingId: string, userId: string, rsvp: string) {
    return this.db.withTenant(companyId, (tx) =>
      tx
        .update(meetingAttendees)
        .set({ rsvp })
        .where(
          and(
            eq(meetingAttendees.companyId, companyId),
            eq(meetingAttendees.meetingId, meetingId),
            eq(meetingAttendees.userId, userId),
          ),
        )
        .returning(),
    );
  }

  // ─── Notes / minutes (G10-4 biên bản) ──────────────────────────────────────

  listNotes(companyId: string, meetingId: string): Promise<MeetingNoteRow[]> {
    return this.db.withTenant(companyId, (tx) =>
      tx
        .select(meetingNoteColumns)
        .from(meetingNotes)
        .where(and(eq(meetingNotes.companyId, companyId), eq(meetingNotes.meetingId, meetingId)))
        .orderBy(desc(meetingNotes.createdAt)),
    );
  }

  /** INSERT note trong tx cấp trên (caller mở withTenant để insert + audit cùng commit). */
  insertNote(tx: TenantTx, data: NewMeetingNote): Promise<MeetingNoteRow[]> {
    return tx.insert(meetingNotes).values(data).returning(meetingNoteColumns);
  }

  /** Tìm note theo id (tenant-scoped) — dùng để guard tồn tại trước khi UPDATE. */
  findNoteByIdTx(tx: TenantTx, companyId: string, noteId: string): Promise<MeetingNoteRow[]> {
    return tx
      .select(meetingNoteColumns)
      .from(meetingNotes)
      .where(and(eq(meetingNotes.companyId, companyId), eq(meetingNotes.id, noteId)));
  }

  updateNote(
    tx: TenantTx,
    companyId: string,
    noteId: string,
    body: string,
  ): Promise<MeetingNoteRow[]> {
    return tx
      .update(meetingNotes)
      .set({ body, updatedAt: new Date() })
      .where(and(eq(meetingNotes.companyId, companyId), eq(meetingNotes.id, noteId)))
      .returning(meetingNoteColumns);
  }

  // ─── Action items link (G10-4 meeting ↔ Task Hub) ──────────────────────────

  /** INSERT link meeting↔task trong tx cấp trên (idempotent qua unique idx — onConflictDoNothing). */
  insertMeetingTask(tx: TenantTx, data: NewMeetingTask): Promise<{ id: string }[]> {
    return tx
      .insert(meetingTasks)
      .values(data)
      .onConflictDoNothing()
      .returning({ id: meetingTasks.id });
  }

  /** Liệt kê action-item của cuộc họp: join meeting_tasks ⨝ tasks (chỉ task chưa soft-delete). */
  listActionItems(companyId: string, meetingId: string): Promise<MeetingActionItemRow[]> {
    return this.db.withTenant(companyId, (tx) =>
      tx
        .select({
          taskId: meetingTasks.taskId,
          title: tasks.title,
          status: tasks.status,
          taskType: tasks.taskType,
          assigneeUserId: tasks.assigneeUserId,
          dueDate: tasks.dueDate,
          linkedAt: meetingTasks.createdAt,
        })
        .from(meetingTasks)
        .innerJoin(tasks, eq(tasks.id, meetingTasks.taskId))
        .where(
          and(
            eq(meetingTasks.companyId, companyId),
            eq(meetingTasks.meetingId, meetingId),
            isNull(tasks.deletedAt),
          ),
        )
        .orderBy(desc(meetingTasks.createdAt)),
    );
  }
}

const meetingNoteColumns = {
  id: meetingNotes.id,
  meetingId: meetingNotes.meetingId,
  authorUserId: meetingNotes.authorUserId,
  body: meetingNotes.body,
  createdAt: meetingNotes.createdAt,
  updatedAt: meetingNotes.updatedAt,
} as const;
