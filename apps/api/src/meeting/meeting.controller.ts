import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UsePipes } from "@nestjs/common";
import { ZodValidationPipe } from "nestjs-zod";
import type { Request } from "express";
import { MeetingService } from "./meeting.service";
import {
  CreateMeetingDto,
  UpdateMeetingDto,
  CreateMeetingRoomDto,
  CreateMeetingNoteDto,
  UpdateMeetingNoteDto,
  CreateMeetingActionDto,
} from "./meeting.dto";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

@Controller("meetings")
@UsePipes(ZodValidationPipe)
export class MeetingController {
  constructor(private readonly svc: MeetingService) {}

  // ─── Meeting Rooms ────────────────────────────────────────────────────────

  /** GET /meetings/rooms */
  @Get("rooms")
  listRooms(@Req() req: AuthenticatedRequest) {
    return this.svc.listRooms(req.user.companyId);
  }

  /** POST /meetings/rooms */
  @Post("rooms")
  createRoom(@Req() req: AuthenticatedRequest, @Body() dto: CreateMeetingRoomDto) {
    return this.svc.createRoom(req.user.companyId, req.user.id, dto);
  }

  /** PATCH /meetings/rooms/:roomId */
  @Patch("rooms/:roomId")
  updateRoom(
    @Req() req: AuthenticatedRequest,
    @Param("roomId") roomId: string,
    @Body() dto: Partial<CreateMeetingRoomDto>,
  ) {
    return this.svc.updateRoom(req.user.companyId, req.user.id, roomId, dto);
  }

  /** DELETE /meetings/rooms/:roomId */
  @Delete("rooms/:roomId")
  deleteRoom(@Req() req: AuthenticatedRequest, @Param("roomId") roomId: string) {
    return this.svc.deleteRoom(req.user.companyId, req.user.id, roomId);
  }

  // ─── Meetings ─────────────────────────────────────────────────────────────

  /** GET /meetings */
  @Get()
  listMeetings(@Req() req: AuthenticatedRequest) {
    return this.svc.listMeetings(req.user.companyId);
  }

  /** GET /meetings/:meetingId */
  @Get(":meetingId")
  getMeeting(@Req() req: AuthenticatedRequest, @Param("meetingId") meetingId: string) {
    return this.svc.getMeeting(req.user.companyId, meetingId);
  }

  /** POST /meetings */
  @Post()
  createMeeting(@Req() req: AuthenticatedRequest, @Body() dto: CreateMeetingDto) {
    return this.svc.createMeeting(req.user.companyId, req.user.id, dto);
  }

  /** PATCH /meetings/:meetingId */
  @Patch(":meetingId")
  updateMeeting(
    @Req() req: AuthenticatedRequest,
    @Param("meetingId") meetingId: string,
    @Body() dto: UpdateMeetingDto,
  ) {
    return this.svc.updateMeeting(req.user.companyId, req.user.id, meetingId, dto);
  }

  /** DELETE /meetings/:meetingId — soft-cancel */
  @Delete(":meetingId")
  cancelMeeting(@Req() req: AuthenticatedRequest, @Param("meetingId") meetingId: string) {
    return this.svc.cancelMeeting(req.user.companyId, req.user.id, meetingId);
  }

  // ─── Notes / minutes (G10-4 biên bản) ──────────────────────────────────────

  /** GET /meetings/:meetingId/notes */
  @Get(":meetingId/notes")
  listNotes(@Req() req: AuthenticatedRequest, @Param("meetingId") meetingId: string) {
    return this.svc.listNotes(req.user.companyId, meetingId);
  }

  /** POST /meetings/:meetingId/notes */
  @Post(":meetingId/notes")
  addNote(
    @Req() req: AuthenticatedRequest,
    @Param("meetingId") meetingId: string,
    @Body() dto: CreateMeetingNoteDto,
  ) {
    return this.svc.addNote(req.user.companyId, req.user.id, meetingId, dto.body);
  }

  /** PATCH /meetings/:meetingId/notes/:noteId */
  @Patch(":meetingId/notes/:noteId")
  updateNote(
    @Req() req: AuthenticatedRequest,
    @Param("meetingId") meetingId: string,
    @Param("noteId") noteId: string,
    @Body() dto: UpdateMeetingNoteDto,
  ) {
    return this.svc.updateNote(req.user.companyId, req.user.id, meetingId, noteId, dto.body);
  }

  // ─── Action items (G10-4 task sau họp → Task Hub G9) ───────────────────────

  /** GET /meetings/:meetingId/action-items */
  @Get(":meetingId/action-items")
  listActionItems(@Req() req: AuthenticatedRequest, @Param("meetingId") meetingId: string) {
    return this.svc.listActionItems(req.user.companyId, meetingId);
  }

  /** POST /meetings/:meetingId/action-items */
  @Post(":meetingId/action-items")
  createActionItem(
    @Req() req: AuthenticatedRequest,
    @Param("meetingId") meetingId: string,
    @Body() dto: CreateMeetingActionDto,
  ) {
    return this.svc.createActionItem(req.user.companyId, req.user.id, meetingId, dto);
  }
}
