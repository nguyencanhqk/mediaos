import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import {
  meetingSchema,
  meetingRoomSchema,
  meetingNoteSchema,
  meetingActionItemSchema,
  type MeetingDto,
  type MeetingRoomDto,
  type MeetingNoteDto,
  type MeetingActionItemDto,
  type CreateMeetingRequest,
  type UpdateMeetingRequest,
  type CreateMeetingRoomRequest,
  type CreateMeetingActionRequest,
} from "@mediaos/contracts";
import {
  MeetingRepository,
  type MeetingRow,
  type MeetingRoomRow,
  type MeetingNoteRow,
  type MeetingActionItemRow,
} from "./meeting.repository";
import { AuditService } from "../events/audit.service";
import { OutboxService } from "../events/outbox.service";
import { DatabaseService } from "../db/db.service";
import { TasksService } from "../tasks/tasks.service";

@Injectable()
export class MeetingService {
  private readonly logger = new Logger(MeetingService.name);

  constructor(
    private readonly repo: MeetingRepository,
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly tasks: TasksService,
  ) {}

  // ─── Masking helpers ──────────────────────────────────────────────────────

  /** Strip cột thừa — chỉ các field trong schema ra client (BẤT BIẾN masking CLAUDE.md §5). */
  private toMeetingDto(row: MeetingRow): MeetingDto {
    return meetingSchema.parse({
      ...row,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    });
  }

  private toRoomDto(row: MeetingRoomRow): MeetingRoomDto {
    return meetingRoomSchema.parse({
      ...row,
      createdAt: row.createdAt.toISOString(),
    });
  }

  private toNoteDto(row: MeetingNoteRow): MeetingNoteDto {
    return meetingNoteSchema.parse({
      ...row,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    });
  }

  private toActionItemDto(row: MeetingActionItemRow): MeetingActionItemDto {
    return meetingActionItemSchema.parse({
      ...row,
      dueDate: row.dueDate ? row.dueDate.toISOString() : null,
      linkedAt: row.linkedAt.toISOString(),
    });
  }

  /**
   * Guard chung cho thao tác sửa-cuộc-họp (biên bản / action-item): chỉ organiser, cuộc họp còn sống.
   * Trả về meeting row đã xác thực. Tách riêng để né lặp giữa addNote/updateNote/createActionItem.
   */
  private async assertOrganizerActiveMeeting(
    companyId: string,
    userId: string,
    meetingId: string,
  ): Promise<MeetingRow> {
    const existing = await this.repo.findMeetingById(companyId, meetingId);
    if (!existing[0]) throw new NotFoundException("Meeting not found");
    if (existing[0].organizerId !== userId) {
      throw new ForbiddenException("Only the organiser can modify this meeting");
    }
    if (existing[0].status === "cancelled") {
      throw new ConflictException("Cannot modify a cancelled meeting");
    }
    return existing[0];
  }

  // ─── MeetingRoom CRUD ─────────────────────────────────────────────────────

  async listRooms(companyId: string): Promise<MeetingRoomDto[]> {
    const rows = await this.repo.listRooms(companyId);
    return rows.map((r) => this.toRoomDto(r));
  }

  async createRoom(
    companyId: string,
    userId: string,
    data: CreateMeetingRoomRequest,
  ): Promise<MeetingRoomDto> {
    const rows = await this.repo.createRoom(companyId, { ...data, createdBy: userId });
    if (!rows[0]) throw new Error("Failed to create meeting room");
    await this.db.withTenant(companyId, (tx) =>
      this.audit.record(tx, {
        action: "create",
        objectType: "meeting_room",
        objectId: rows[0]!.id,
        actorUserId: userId,
        after: data,
      }),
    );
    return this.toRoomDto(rows[0]);
  }

  async updateRoom(
    companyId: string,
    userId: string,
    roomId: string,
    data: Partial<CreateMeetingRoomRequest>,
  ): Promise<MeetingRoomDto> {
    const rows = await this.repo.updateRoom(companyId, roomId, data);
    if (!rows[0]) throw new NotFoundException("Meeting room not found");
    await this.db.withTenant(companyId, (tx) =>
      this.audit.record(tx, {
        action: "update",
        objectType: "meeting_room",
        objectId: roomId,
        actorUserId: userId,
        after: data,
      }),
    );
    return this.toRoomDto(rows[0]);
  }

  async deleteRoom(companyId: string, userId: string, roomId: string): Promise<void> {
    const rows = await this.repo.softDeleteRoom(companyId, roomId);
    if (!rows[0]) throw new NotFoundException("Meeting room not found");
    await this.db.withTenant(companyId, (tx) =>
      this.audit.record(tx, {
        action: "delete",
        objectType: "meeting_room",
        objectId: roomId,
        actorUserId: userId,
      }),
    );
  }

  // ─── Meeting CRUD ─────────────────────────────────────────────────────────

  async listMeetings(companyId: string, organizerId?: string): Promise<MeetingDto[]> {
    const rows = await this.repo.listMeetings(companyId, organizerId);
    return rows.map((r) => this.toMeetingDto(r));
  }

  async getMeeting(companyId: string, meetingId: string): Promise<MeetingDto> {
    const rows = await this.repo.findMeetingById(companyId, meetingId);
    if (!rows[0]) throw new NotFoundException("Meeting not found");
    return this.toMeetingDto(rows[0]);
  }

  /**
   * createMeeting — double-booking guard + INSERT trong cùng 1 withTenant tx.
   * Race safety: DB EXCLUDE GIST constraint là lớp 2; service check là lớp 1 (lỗi tường minh).
   */
  async createMeeting(
    companyId: string,
    userId: string,
    data: CreateMeetingRequest,
  ): Promise<MeetingDto> {
    const startsAt = new Date(data.startsAt);
    const endsAt = new Date(data.endsAt);

    if (endsAt <= startsAt) {
      throw new ConflictException("ends_at must be after starts_at");
    }

    const meeting = await this.db.withTenant(companyId, async (tx) => {
      // Double-booking check (application-level lớp 1)
      if (data.meetingRoomId) {
        const overlap = await this.repo.checkDoubleBooking(
          tx,
          companyId,
          data.meetingRoomId,
          startsAt,
          endsAt,
        );
        const count = Number(overlap[0]?.count ?? 0);
        if (count > 0) {
          throw new ConflictException("Meeting room is already booked for the requested time slot");
        }
      }

      const inserted = await this.repo.insertMeeting(tx, {
        companyId,
        meetingRoomId: data.meetingRoomId ?? null,
        title: data.title,
        description: data.description ?? null,
        startsAt,
        endsAt,
        organizerId: userId,
        agenda: data.agenda,
      });
      const row = inserted[0];
      if (!row) throw new Error("Failed to create meeting");

      // Seed attendees (organiser always accepted)
      const userIds = Array.from(new Set([userId, ...data.attendeeIds]));
      await this.repo.insertAttendees(
        tx,
        userIds.map((uid) => ({
          companyId,
          meetingId: row.id,
          userId: uid,
          rsvp: uid === userId ? "accepted" : "pending",
        })),
      );

      await this.audit.record(tx, {
        action: "create",
        objectType: "meeting",
        objectId: row.id,
        actorUserId: userId,
        after: data,
      });

      await this.outbox.enqueue(tx, {
        eventType: "meeting.created",
        payload: { meetingId: row.id, title: row.title, organizerId: userId },
      });

      return row;
    });

    return this.toMeetingDto(meeting);
  }

  async updateMeeting(
    companyId: string,
    userId: string,
    meetingId: string,
    data: UpdateMeetingRequest,
  ): Promise<MeetingDto> {
    const existing = await this.repo.findMeetingById(companyId, meetingId);
    if (!existing[0]) throw new NotFoundException("Meeting not found");
    if (existing[0].organizerId !== userId) {
      throw new ForbiddenException("Only the organiser can update this meeting");
    }
    if (existing[0].status === "cancelled") {
      throw new ConflictException("Cannot update a cancelled meeting");
    }

    const startsAt = data.startsAt ? new Date(data.startsAt) : existing[0].startsAt;
    const endsAt = data.endsAt ? new Date(data.endsAt) : existing[0].endsAt;
    const roomId =
      data.meetingRoomId !== undefined ? data.meetingRoomId : existing[0].meetingRoomId;

    if (endsAt <= startsAt) {
      throw new ConflictException("ends_at must be after starts_at");
    }

    // Double-booking check when room or time changes
    if (roomId && (data.meetingRoomId !== undefined || data.startsAt || data.endsAt)) {
      const overlap = await this.db.withTenant(companyId, (tx) =>
        this.repo.checkDoubleBooking(tx, companyId, roomId, startsAt, endsAt, meetingId),
      );
      const count = Number(overlap[0]?.count ?? 0);
      if (count > 0) {
        throw new ConflictException("Meeting room is already booked for the requested time slot");
      }
    }

    const rows = await this.repo.updateMeeting(companyId, meetingId, {
      ...(data.title !== undefined && { title: data.title }),
      ...(data.description !== undefined && { description: data.description }),
      ...(data.meetingRoomId !== undefined && { meetingRoomId: data.meetingRoomId }),
      ...(data.startsAt !== undefined && { startsAt }),
      ...(data.endsAt !== undefined && { endsAt }),
      ...(data.agenda !== undefined && { agenda: data.agenda }),
    });

    if (!rows[0]) throw new NotFoundException("Meeting not found");

    await this.db.withTenant(companyId, (tx) =>
      this.audit.record(tx, {
        action: "update",
        objectType: "meeting",
        objectId: meetingId,
        actorUserId: userId,
        after: data,
      }),
    );

    return this.toMeetingDto(rows[0]);
  }

  async cancelMeeting(companyId: string, userId: string, meetingId: string): Promise<MeetingDto> {
    const existing = await this.repo.findMeetingById(companyId, meetingId);
    if (!existing[0]) throw new NotFoundException("Meeting not found");
    if (existing[0].organizerId !== userId) {
      throw new ForbiddenException("Only the organiser can cancel this meeting");
    }
    if (existing[0].status === "cancelled") {
      throw new ConflictException("Meeting already cancelled");
    }

    const rows = await this.repo.cancelMeeting(companyId, meetingId);
    if (!rows[0]) throw new NotFoundException("Meeting not found");

    await this.db.withTenant(companyId, async (tx) => {
      await this.audit.record(tx, {
        action: "cancel",
        objectType: "meeting",
        objectId: meetingId,
        actorUserId: userId,
      });
      await this.outbox.enqueue(tx, {
        eventType: "meeting.cancelled",
        payload: { meetingId, cancelledBy: userId },
      });
    });

    return this.toMeetingDto(rows[0]);
  }

  // ─── Notes / minutes (G10-4 biên bản) ──────────────────────────────────────

  /** Liệt kê biên bản của cuộc họp (tenant-scoped, mới nhất trước). */
  async listNotes(companyId: string, meetingId: string): Promise<MeetingNoteDto[]> {
    const meeting = await this.repo.findMeetingById(companyId, meetingId);
    if (!meeting[0]) throw new NotFoundException("Meeting not found");
    const rows = await this.repo.listNotes(companyId, meetingId);
    return rows.map((r) => this.toNoteDto(r));
  }

  /** Ghi biên bản mới — chỉ organiser, cuộc họp còn sống. INSERT + audit cùng 1 tx. */
  async addNote(
    companyId: string,
    userId: string,
    meetingId: string,
    body: string,
  ): Promise<MeetingNoteDto> {
    await this.assertOrganizerActiveMeeting(companyId, userId, meetingId);

    const note = await this.db.withTenant(companyId, async (tx) => {
      const inserted = await this.repo.insertNote(tx, {
        companyId,
        meetingId,
        authorUserId: userId,
        body,
      });
      const row = inserted[0];
      if (!row) throw new Error("Failed to create meeting note");

      await this.audit.record(tx, {
        action: "create",
        objectType: "meeting_note",
        objectId: row.id,
        actorUserId: userId,
        after: { meetingId, body },
      });
      return row;
    });

    return this.toNoteDto(note);
  }

  /** Sửa biên bản — chỉ organiser, cuộc họp còn sống. UPDATE + audit cùng 1 tx. */
  async updateNote(
    companyId: string,
    userId: string,
    meetingId: string,
    noteId: string,
    body: string,
  ): Promise<MeetingNoteDto> {
    await this.assertOrganizerActiveMeeting(companyId, userId, meetingId);

    const note = await this.db.withTenant(companyId, async (tx) => {
      const existing = await this.repo.findNoteByIdTx(tx, companyId, noteId);
      if (!existing[0] || existing[0].meetingId !== meetingId) {
        throw new NotFoundException("Meeting note not found");
      }

      const updated = await this.repo.updateNote(tx, companyId, noteId, body);
      const row = updated[0];
      if (!row) throw new NotFoundException("Meeting note not found");

      await this.audit.record(tx, {
        action: "update",
        objectType: "meeting_note",
        objectId: noteId,
        actorUserId: userId,
        before: { body: existing[0].body },
        after: { body },
      });
      return row;
    });

    return this.toNoteDto(note);
  }

  // ─── Action items (G10-4 task sau họp → Task Hub G9) ───────────────────────

  /** Liệt kê action-item của cuộc họp (join sang Task Hub). */
  async listActionItems(companyId: string, meetingId: string): Promise<MeetingActionItemDto[]> {
    const meeting = await this.repo.findMeetingById(companyId, meetingId);
    if (!meeting[0]) throw new NotFoundException("Meeting not found");
    const rows = await this.repo.listActionItems(companyId, meetingId);
    return rows.map((r) => this.toActionItemDto(r));
  }

  /**
   * Tạo action-item sau họp → ghi vào **Task Hub G9** (`task_type='meeting_action'`, BẤT BIẾN #4 —
   * KHÔNG bảng task riêng) rồi LINK qua meeting_tasks. Chỉ organiser, cuộc họp còn sống.
   *
   * Trình tự: (1) guard organiser → (2) TasksService.createMeetingActionTask (tx riêng, có FK-guard +
   * audit 'task') → (3) INSERT link + audit 'meeting' + outbox cùng 1 tx. Task tạo TRƯỚC link nên nếu
   * link lỗi thì task vẫn ở hub (recoverable) — KHÔNG để link mồ côi trỏ task không tồn tại.
   */
  async createActionItem(
    companyId: string,
    userId: string,
    meetingId: string,
    data: CreateMeetingActionRequest,
  ): Promise<MeetingActionItemDto> {
    await this.assertOrganizerActiveMeeting(companyId, userId, meetingId);

    const task = await this.tasks.createMeetingActionTask(
      { id: userId, companyId },
      {
        title: data.title,
        assigneeUserId: data.assigneeUserId ?? null,
        dueDate: data.dueDate ?? null,
      },
    );

    await this.db.withTenant(companyId, async (tx) => {
      await this.repo.insertMeetingTask(tx, { companyId, meetingId, taskId: task.id });

      await this.audit.record(tx, {
        action: "MeetingActionTaskCreated",
        objectType: "meeting",
        objectId: meetingId,
        actorUserId: userId,
        after: { taskId: task.id, title: data.title, assigneeUserId: data.assigneeUserId ?? null },
      });

      await this.outbox.enqueue(tx, {
        eventType: "meeting.action_task.created",
        payload: {
          meetingId,
          taskId: task.id,
          assigneeUserId: data.assigneeUserId ?? null,
          createdBy: userId,
        },
      });
    });

    return this.toActionItemDto({
      taskId: task.id,
      title: task.title,
      status: task.status,
      taskType: task.taskType,
      assigneeUserId: task.assigneeUserId,
      dueDate: task.dueDate ? new Date(task.dueDate) : null,
      linkedAt: new Date(task.createdAt),
    });
  }
}
