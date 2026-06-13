import { z } from "zod";

// ─── MeetingRoom ──────────────────────────────────────────────────────────────

export const meetingRoomSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  name: z.string(),
  location: z.string().nullable(),
  capacity: z.number().int().positive().nullable(),
  isVirtual: z.boolean(),
  createdAt: z.string().datetime(),
});
export type MeetingRoomDto = z.infer<typeof meetingRoomSchema>;

export const createMeetingRoomSchema = z.object({
  name: z.string().min(1).max(200),
  location: z.string().max(500).optional(),
  capacity: z.number().int().positive().optional(),
  isVirtual: z.boolean().default(false),
});
export type CreateMeetingRoomRequest = z.infer<typeof createMeetingRoomSchema>;

// ─── Meeting ──────────────────────────────────────────────────────────────────

export const meetingStatusSchema = z.enum(["scheduled", "cancelled", "completed"]);
export type MeetingStatus = z.infer<typeof meetingStatusSchema>;

export const meetingSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  meetingRoomId: z.string().uuid().nullable(),
  title: z.string(),
  description: z.string().nullable(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  organizerId: z.string().uuid(),
  status: meetingStatusSchema,
  agenda: z.array(z.unknown()),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type MeetingDto = z.infer<typeof meetingSchema>;

export const createMeetingSchema = z.object({
  title: z.string().min(1).max(300),
  description: z.string().max(2000).optional(),
  meetingRoomId: z.string().uuid().optional(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  attendeeIds: z.array(z.string().uuid()).default([]),
  agenda: z.array(z.unknown()).default([]),
});
export type CreateMeetingRequest = z.infer<typeof createMeetingSchema>;

export const updateMeetingSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  description: z.string().max(2000).optional(),
  meetingRoomId: z.string().uuid().nullable().optional(),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().optional(),
  attendeeIds: z.array(z.string().uuid()).optional(),
  agenda: z.array(z.unknown()).optional(),
});
export type UpdateMeetingRequest = z.infer<typeof updateMeetingSchema>;

// ─── Attendee ─────────────────────────────────────────────────────────────────

export const meetingRsvpSchema = z.enum(["pending", "accepted", "declined"]);
export type MeetingRsvp = z.infer<typeof meetingRsvpSchema>;

export const meetingAttendeeSchema = z.object({
  id: z.string().uuid(),
  meetingId: z.string().uuid(),
  userId: z.string().uuid(),
  rsvp: meetingRsvpSchema,
  joinedAt: z.string().datetime(),
});
export type MeetingAttendeeDto = z.infer<typeof meetingAttendeeSchema>;

// ─── Meeting notes / minutes (G10-4 biên bản) ──────────────────────────────────
// Biên bản cuộc họp. Sửa được (UPDATE) nhưng KHÔNG xoá (append-only-ish — không cấp DELETE).

export const meetingNoteSchema = z.object({
  id: z.string().uuid(),
  meetingId: z.string().uuid(),
  authorUserId: z.string().uuid(),
  body: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type MeetingNoteDto = z.infer<typeof meetingNoteSchema>;

export const createMeetingNoteSchema = z.object({
  body: z.string().min(1).max(20000),
});
export type CreateMeetingNoteRequest = z.infer<typeof createMeetingNoteSchema>;

export const updateMeetingNoteSchema = z.object({
  body: z.string().min(1).max(20000),
});
export type UpdateMeetingNoteRequest = z.infer<typeof updateMeetingNoteSchema>;

// ─── Meeting action items (G10-4 task sau họp → Task Hub G9) ────────────────────
// Action-item sau họp ghi thẳng vào bảng `tasks` (task_type='meeting_action', BẤT BIẾN #4 —
// KHÔNG bảng riêng). meeting_tasks chỉ là bảng LIÊN KẾT meeting↔task. Phản hồi = TaskDto.

export const createMeetingActionSchema = z.object({
  title: z.string().min(1).max(200),
  assigneeUserId: z.string().uuid().nullable().optional(),
  dueDate: z.string().datetime().nullable().optional(),
});
export type CreateMeetingActionRequest = z.infer<typeof createMeetingActionSchema>;

/** Compact view của một action-item gắn cuộc họp (join meeting_tasks ⨝ tasks). */
export const meetingActionItemSchema = z.object({
  taskId: z.string().uuid(),
  title: z.string(),
  status: z.string(),
  taskType: z.string(),
  assigneeUserId: z.string().uuid().nullable(),
  dueDate: z.string().datetime().nullable(),
  linkedAt: z.string().datetime(),
});
export type MeetingActionItemDto = z.infer<typeof meetingActionItemSchema>;
