import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UsePipes,
} from "@nestjs/common";
import { ZodValidationPipe } from "nestjs-zod";
import type { Request } from "express";
import { MeetingService } from "./meeting.service";
import { CreateMeetingDto, UpdateMeetingDto, CreateMeetingRoomDto } from "./meeting.dto";

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
}
