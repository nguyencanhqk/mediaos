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
