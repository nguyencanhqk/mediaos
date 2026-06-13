/**
 * G10-4 Meeting service deny-path tests (TASKS.md §5.5 — RED trước implement).
 *
 * Bắt buộc theo nhiệm vụ:
 *   A. double-booking: cùng phòng + overlap khung giờ → ConflictException.
 *   B. cross-tenant: user công ty B KHÔNG thấy meeting công ty A (tenant-iso 2-tenant → 0 row).
 *   C. masking: row DB không rò field thừa qua meetingSchema.parse.
 *   D. cancel guards: không phải organiser → ForbiddenException; đã cancelled → ConflictException.
 *
 * Dùng mock repo + mock db.withTenant (không cần Postgres).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { meetingSchema } from "@mediaos/contracts";
import { MeetingService } from "./meeting.service";
import type { MeetingRepository } from "./meeting.repository";
import type { AuditService } from "../events/audit.service";
import type { OutboxService } from "../events/outbox.service";
import type { DatabaseService } from "../db/db.service";

// ─── constants ────────────────────────────────────────────────────────────────

const CO_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const CO_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const USER_A = "a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1";
const USER_B = "b1b1b1b1-b1b1-b1b1-b1b1-b1b1b1b1b1b1";
const MEETING_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const ROOM_ID = "dddddddd-dddd-dddd-dddd-dddddddddddd";

const STARTS = "2024-06-01T09:00:00.000Z";
const ENDS   = "2024-06-01T10:00:00.000Z";
// Overlap: 09:30–10:30 overlaps [09:00,10:00)
const STARTS_OVERLAP = "2024-06-01T09:30:00.000Z";
const ENDS_OVERLAP   = "2024-06-01T10:30:00.000Z";
// Adjacent (non-overlap): 10:00–11:00 does NOT overlap [09:00,10:00) end-exclusive
const STARTS_ADJACENT = "2024-06-01T10:00:00.000Z";
const ENDS_ADJACENT   = "2024-06-01T11:00:00.000Z";

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeMeetingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: MEETING_ID,
    companyId: CO_A,
    meetingRoomId: ROOM_ID,
    title: "Sprint Planning",
    description: null,
    startsAt: new Date(STARTS),
    endsAt: new Date(ENDS),
    organizerId: USER_A,
    status: "scheduled",
    agenda: [],
    createdAt: new Date("2024-01-01T00:00:00Z"),
    updatedAt: new Date("2024-01-01T00:00:00Z"),
    // extra internal column — must NOT appear in DTO
    __internal_raw_data: "must-be-stripped",
    ...overrides,
  };
}

function makeRepo(): MeetingRepository {
  return {
    listRooms: vi.fn().mockResolvedValue([]),
    createRoom: vi.fn(),
    updateRoom: vi.fn(),
    softDeleteRoom: vi.fn(),
    listMeetings: vi.fn().mockResolvedValue([]),
    findMeetingById: vi.fn().mockResolvedValue([]),
    insertMeeting: vi.fn(),
    updateMeeting: vi.fn(),
    cancelMeeting: vi.fn(),
    checkDoubleBooking: vi.fn().mockResolvedValue([{ count: 0 }]),
    listAttendees: vi.fn().mockResolvedValue([]),
    insertAttendees: vi.fn().mockResolvedValue([]),
    updateRsvp: vi.fn(),
  } as unknown as MeetingRepository;
}

function makeAudit(): AuditService {
  return { record: vi.fn().mockResolvedValue(undefined) } as unknown as AuditService;
}

function makeOutbox(): OutboxService {
  return { enqueue: vi.fn().mockResolvedValue(undefined) } as unknown as OutboxService;
}

/** db mock: withTenant calls fn(tx) where tx proxies the repo for mock assertions. */
function makeDb(repo: MeetingRepository): DatabaseService {
  return {
    withTenant: vi.fn().mockImplementation((_companyId: string, fn: (tx: unknown) => unknown) =>
      fn(repo),
    ),
  } as unknown as DatabaseService;
}

function makeService(repo: MeetingRepository, db?: DatabaseService) {
  const resolvedDb = db ?? makeDb(repo);
  return new MeetingService(repo, resolvedDb, makeAudit(), makeOutbox());
}

// ─── A. Double-booking ────────────────────────────────────────────────────────

describe("A. double-booking guard", () => {
  it("throws ConflictException when room already booked (overlap)", async () => {
    const repo = makeRepo();
    // Simulate existing booking in the room
    vi.mocked(repo.checkDoubleBooking).mockResolvedValue([{ count: 1 }]);
    vi.mocked(repo.insertMeeting).mockResolvedValue([makeMeetingRow()]);

    const svc = makeService(repo);
    await expect(
      svc.createMeeting(CO_A, USER_A, {
        title: "New Meeting",
        startsAt: STARTS_OVERLAP,
        endsAt: ENDS_OVERLAP,
        meetingRoomId: ROOM_ID,
        attendeeIds: [],
        agenda: [],
      }),
    ).rejects.toThrow(ConflictException);
  });

  it("allows booking when room is free (no overlap)", async () => {
    const repo = makeRepo();
    vi.mocked(repo.checkDoubleBooking).mockResolvedValue([{ count: 0 }]);
    const row = makeMeetingRow({ startsAt: new Date(STARTS_ADJACENT), endsAt: new Date(ENDS_ADJACENT) });
    vi.mocked(repo.insertMeeting).mockResolvedValue([row]);

    const svc = makeService(repo);
    await expect(
      svc.createMeeting(CO_A, USER_A, {
        title: "Adjacent Meeting",
        startsAt: STARTS_ADJACENT,
        endsAt: ENDS_ADJACENT,
        meetingRoomId: ROOM_ID,
        attendeeIds: [],
        agenda: [],
      }),
    ).resolves.toBeDefined();
  });

  it("allows meeting without a room (no double-booking check)", async () => {
    const repo = makeRepo();
    const row = makeMeetingRow({ meetingRoomId: null });
    vi.mocked(repo.insertMeeting).mockResolvedValue([row]);

    const svc = makeService(repo);
    const result = await svc.createMeeting(CO_A, USER_A, {
      title: "No Room",
      startsAt: STARTS,
      endsAt: ENDS,
      attendeeIds: [],
      agenda: [],
    });

    expect(result).toBeDefined();
    // checkDoubleBooking should NOT be called when no room
    expect(repo.checkDoubleBooking).not.toHaveBeenCalled();
  });

  it("throws ConflictException when ends_at <= starts_at", async () => {
    const repo = makeRepo();
    const svc = makeService(repo);
    await expect(
      svc.createMeeting(CO_A, USER_A, {
        title: "Bad Time",
        startsAt: ENDS,
        endsAt: STARTS,
        attendeeIds: [],
        agenda: [],
      }),
    ).rejects.toThrow(ConflictException);
  });
});

// ─── B. Cross-tenant isolation ────────────────────────────────────────────────

describe("B. cross-tenant isolation", () => {
  it("listMeetings returns 0 rows for company B when only company A has meetings", async () => {
    const repo = makeRepo();
    // Company A has meetings; company B repo returns []
    vi.mocked(repo.listMeetings).mockImplementation((companyId: string) =>
      Promise.resolve(companyId === CO_A ? [makeMeetingRow()] : []),
    );

    const svc = makeService(repo);
    const resultA = await svc.listMeetings(CO_A);
    const resultB = await svc.listMeetings(CO_B);

    expect(resultA).toHaveLength(1);
    expect(resultB).toHaveLength(0);
  });

  it("getMeeting throws NotFoundException for company B accessing company A meeting", async () => {
    const repo = makeRepo();
    // Company B's tenant context → withTenant(CO_B) → RLS → 0 row
    vi.mocked(repo.findMeetingById).mockImplementation((companyId: string) =>
      Promise.resolve(companyId === CO_B ? [] : [makeMeetingRow()]),
    );

    const svc = makeService(repo);
    await expect(svc.getMeeting(CO_B, MEETING_ID)).rejects.toThrow(NotFoundException);
  });

  it("listRooms for company B returns 0 rooms (company A rooms invisible)", async () => {
    const repo = makeRepo();
    vi.mocked(repo.listRooms).mockImplementation((companyId: string) =>
      Promise.resolve(companyId === CO_B ? [] : [{
        id: ROOM_ID, companyId: CO_A, name: "Room A", location: null,
        capacity: 10, isVirtual: false, createdAt: new Date(),
      }]),
    );

    const svc = makeService(repo);
    const rooms = await svc.listRooms(CO_B);
    expect(rooms).toHaveLength(0);
  });
});

// ─── C. Masking — meetingSchema.parse strips extra fields ─────────────────────

describe("C. masking — DTO strips internal fields", () => {
  it("meetingSchema.parse strips __internal_raw_data", () => {
    const raw = {
      id: MEETING_ID,
      companyId: CO_A,
      meetingRoomId: ROOM_ID,
      title: "Test",
      description: null,
      startsAt: new Date(STARTS).toISOString(),
      endsAt: new Date(ENDS).toISOString(),
      organizerId: USER_A,
      status: "scheduled" as const,
      agenda: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      __internal_raw_data: "MUST NOT LEAK",
    };
    const dto = meetingSchema.parse(raw);
    expect((dto as Record<string, unknown>)["__internal_raw_data"]).toBeUndefined();
  });

  it("listMeetings returns DTO without internal fields", async () => {
    const repo = makeRepo();
    vi.mocked(repo.listMeetings).mockResolvedValue([makeMeetingRow()]);

    const svc = makeService(repo);
    const [dto] = await svc.listMeetings(CO_A);
    expect((dto as Record<string, unknown>)["__internal_raw_data"]).toBeUndefined();
  });
});

// ─── D. Cancel / update guards ────────────────────────────────────────────────

describe("D. cancel and update guards", () => {
  it("cancelMeeting throws ForbiddenException when caller is not organiser", async () => {
    const repo = makeRepo();
    vi.mocked(repo.findMeetingById).mockResolvedValue([makeMeetingRow()]);

    const svc = makeService(repo);
    await expect(svc.cancelMeeting(CO_A, USER_B, MEETING_ID)).rejects.toThrow(ForbiddenException);
  });

  it("cancelMeeting throws ConflictException when already cancelled", async () => {
    const repo = makeRepo();
    vi.mocked(repo.findMeetingById).mockResolvedValue([makeMeetingRow({ status: "cancelled" })]);

    const svc = makeService(repo);
    await expect(svc.cancelMeeting(CO_A, USER_A, MEETING_ID)).rejects.toThrow(ConflictException);
  });

  it("updateMeeting throws ForbiddenException when caller is not organiser", async () => {
    const repo = makeRepo();
    vi.mocked(repo.findMeetingById).mockResolvedValue([makeMeetingRow()]);

    const svc = makeService(repo);
    await expect(
      svc.updateMeeting(CO_A, USER_B, MEETING_ID, { title: "Hack" }),
    ).rejects.toThrow(ForbiddenException);
  });

  it("updateMeeting throws ConflictException when meeting already cancelled", async () => {
    const repo = makeRepo();
    vi.mocked(repo.findMeetingById).mockResolvedValue([makeMeetingRow({ status: "cancelled" })]);

    const svc = makeService(repo);
    await expect(
      svc.updateMeeting(CO_A, USER_A, MEETING_ID, { title: "New Title" }),
    ).rejects.toThrow(ConflictException);
  });

  it("cancelMeeting succeeds when caller is organiser and meeting is active", async () => {
    const repo = makeRepo();
    const row = makeMeetingRow({ status: "cancelled" });
    vi.mocked(repo.findMeetingById).mockResolvedValue([makeMeetingRow()]);
    vi.mocked(repo.cancelMeeting).mockResolvedValue([row]);

    const svc = makeService(repo);
    const result = await svc.cancelMeeting(CO_A, USER_A, MEETING_ID);
    expect(result).toBeDefined();
    expect(result.status).toBe("cancelled");
  });
});
