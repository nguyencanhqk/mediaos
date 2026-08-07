import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
  UsePipes,
} from "@nestjs/common";
import { ZodValidationPipe } from "nestjs-zod";
import type { Request } from "express";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";
import { ChatMembersService } from "./chat-members.service";
import { ChatRoomPrefsService } from "./chat-room-prefs.service";
import { ChatRoomsService } from "./chat-rooms.service";
import { ChatTypingService } from "./chat-typing.service";
import {
  AddChatMemberDto,
  ChatMuteRoomDto,
  CreateChatRoomDto,
  ListChatRoomsQueryDto,
  OpenDirectRoomDto,
  UpdateChatMemberDto,
  UpdateChatRoomDto,
} from "./chat.dto";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * S7-CHAT-BE-1 — `ChatRoomsController` (SPEC-15 §15 · API-13 §5.1: CHAT-API-001..008). Prefix `/chat`.
 *
 * Pipeline toàn cục `JwtAuthGuard → CompanyGuard → TwoFactorEnforcementGuard` chạy TRƯỚC. MỖI route khai
 * `@UseGuards(PermissionGuard)` + `@RequirePermission` đúng cặp đã seed ở mig `0538` (SPEC-15 §11).
 * `PermissionGuard` là **opt-in per-route** ở dự án này — quên `@UseGuards` là route MỞ cho mọi user đã
 * đăng nhập, IM LẶNG (memory `s1-fnd-module-metadata-seed-drift`); `route-guard-coverage.e2e-spec` gác
 * việc đó nên mọi route thêm sau phải regen census.
 *
 * ⚠️ HAI TẦNG KHÁC NHAU, đừng nhầm:
 *   • `@RequirePermission` = CỔNG MODULE — "được làm hành động gì" (cặp quyền);
 *   • `assertMember` ở service = RANH GIỚI DỮ LIỆU — "ở phòng nào".
 * Cả hai phải cùng đúng (SPEC-15 §3.2). Guard KHÔNG thay được membership: `view:chat-room` @Company
 * KHÔNG cho đọc phòng mình không thuộc.
 *
 * ⚠️ THỨ TỰ ROUTE: `POST /chat/rooms/direct` PHẢI khai TRƯỚC các route `:id`, nếu không Nest nuốt
 * 'direct' thành tham số `:id` (và vì `:id` có `ParseUUIDPipe` thì ra 400 khó hiểu thay vì 404/200).
 *
 * ⚠️ KHÔNG có route nào của `/chat/oversight/*` ở đây — đường đọc-vượt membership (CHAT-DEC-004) là
 * controller RIÊNG ở `S7-CHAT-BE-7`, path riêng, cặp quyền riêng `('view','chat-oversight')`.
 */
@Controller("chat")
@UsePipes(ZodValidationPipe)
export class ChatRoomsController {
  constructor(
    private readonly rooms: ChatRoomsService,
    private readonly members: ChatMembersService,
    // S8-CHAT-UX-RT-1 (additive) — CHAT-API-023.
    private readonly typingService: ChatTypingService,
    // S8-CHAT-UX-BE-1 (additive) — CHAT-API-024a/b · 025 · 020.
    private readonly prefs: ChatRoomPrefsService,
  ) {}

  /** GET /chat/rooms — CHAT-API-001. Tự-bound theo actor; 1 truy vấn, unread bằng phép trừ. */
  @Get("rooms")
  @UseGuards(PermissionGuard)
  @RequirePermission("view", "chat-room")
  listRooms(@Req() req: AuthenticatedRequest, @Query() query: ListChatRoomsQueryDto) {
    return this.rooms.listRooms(req.user, query);
  }

  /** POST /chat/rooms — CHAT-API-002. Người tạo thành `admin` phòng. */
  @Post("rooms")
  @UseGuards(PermissionGuard)
  @RequirePermission("create", "chat-room")
  createRoom(@Req() req: AuthenticatedRequest, @Body() dto: CreateChatRoomDto) {
    return this.rooms.createGroup(req.user, dto);
  }

  /**
   * POST /chat/rooms/direct — CHAT-API-003. KHAI TRƯỚC ':id'.
   *
   * `@HttpCode(200)` cho CẢ lần tạo đầu: idempotent nghĩa là gọi bao nhiêu lần cũng CÙNG kết quả —
   * 201-rồi-200 buộc client phải phân biệt hai lần gọi giống hệt nhau, đúng thứ idempotency xoá bỏ.
   */
  @Post("rooms/direct")
  @HttpCode(200)
  @UseGuards(PermissionGuard)
  @RequirePermission("create", "chat-room")
  openDirect(@Req() req: AuthenticatedRequest, @Body() dto: OpenDirectRoomDto) {
    return this.rooms.openDirect(req.user, dto);
  }

  /** GET /chat/rooms/:id — CHAT-API-004. Phòng lạ/không thuộc ⇒ 404 GIỐNG HỆT nhau. */
  @Get("rooms/:id")
  @UseGuards(PermissionGuard)
  @RequirePermission("view", "chat-room")
  getRoom(@Req() req: AuthenticatedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.rooms.getRoom(req.user, id);
  }

  /** PATCH /chat/rooms/:id — CHAT-API-005. Chỉ phòng nhóm, chỉ admin phòng. */
  @Patch("rooms/:id")
  @UseGuards(PermissionGuard)
  @RequirePermission("update", "chat-room")
  updateRoom(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateChatRoomDto,
  ) {
    return this.rooms.updateRoom(req.user, id, dto);
  }

  /** POST /chat/rooms/:id/archive — CHAT-API-006. Sau khi lưu trữ, phòng CHỈ ĐỌC. */
  @Post("rooms/:id/archive")
  @HttpCode(200)
  @UseGuards(PermissionGuard)
  @RequirePermission("archive", "chat-room")
  archiveRoom(@Req() req: AuthenticatedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.rooms.archiveRoom(req.user, id);
  }

  /**
   * POST /chat/rooms/:id/leave — CHAT-API-008. Cặp `view:chat-room` (API-13 §5.1), KHÔNG phải
   * `manage:chat-member`: rời phòng là thao tác trên tư cách CỦA CHÍNH MÌNH, không phải quản trị người
   * khác. Gắn cặp quản trị vào đây sẽ nhốt nhân viên thường trong mọi phòng họ được thêm vào.
   */
  @Post("rooms/:id/leave")
  @HttpCode(200)
  @UseGuards(PermissionGuard)
  @RequirePermission("view", "chat-room")
  leaveRoom(@Req() req: AuthenticatedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.rooms.leaveRoom(req.user, id);
  }

  /**
   * POST /chat/rooms/:id/typing — CHAT-API-023 (S8 · CHAT-DEC-017). Báo "đang gõ" → fan-out `chat:typing`.
   *
   * `204` cho MỌI nhánh thành công, kể cả khi bị tiết lưu hoặc phòng đã lưu trữ (không emit): client không
   * có gì để xử lý khác đi giữa các nhánh đó.
   *
   * Cặp `('send','chat-message')` — KHÔNG phải `('view','chat-room')`: "đang gõ" là lời hứa sắp GỬI. Ai
   * chỉ có quyền đọc mà báo được đang gõ thì màn hình hiện một tin nhắn sẽ không bao giờ tới.
   */
  @Post("rooms/:id/typing")
  @HttpCode(204)
  @UseGuards(PermissionGuard)
  @RequirePermission("send", "chat-message")
  typing(@Req() req: AuthenticatedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.typingService.ping(req.user, id);
  }

  /**
   * ═══════ S8-CHAT-UX-BE-1 — tuỳ chọn per-phòng CỦA CHÍNH NGƯỜI GỌI ═══════
   *
   * Cả bốn route dùng cặp **`('view','chat-room')`** — KHÔNG phải `('update','chat-room')`: ghim, tắt
   * thông báo, đánh dấu chưa đọc ghi lên hàng `chat_room_members` CỦA MÌNH, không sửa gì của phòng.
   * Gắn cặp quản trị vào đây là giấu tuỳ chọn cá nhân sau cổng quyền quản trị (memory
   * `personal-prefs-must-not-sit-behind-permission-gate`) và làm nhân viên thường không tắt nổi thông
   * báo của chính họ. SPEC-15 §11 ghi rõ toàn bộ 7 tính năng S8 dùng lại đúng 10 cặp cũ — 0 cặp mới.
   *
   * ⚠️ Mã API: `024a/024b` (ghim) và `025` (tắt thông báo), **KHÔNG** phải `018a/018b/019` như bảng
   * `API-13 §5.1b` seed lần đầu — dải đó đã thuộc `/chat/oversight/*` từ wave S7 và literal của nó
   * đang nằm trong `audit_logs.metadata.endpoint` trên PROD. Xem `docs/plans/S8-CHAT-UX-BE-1.md` §0.
   */

  /** PUT /chat/rooms/:id/pin — CHAT-API-024a. Trần 10/người ⇒ 409 CHAT-ERR-021. Idempotent. */
  @Put("rooms/:id/pin")
  @UseGuards(PermissionGuard)
  @RequirePermission("view", "chat-room")
  pinRoom(@Req() req: AuthenticatedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.prefs.pin(req.user, id);
  }

  /** DELETE /chat/rooms/:id/pin — CHAT-API-024b. Bỏ ghim; phòng chưa ghim vẫn 200 (idempotent). */
  @Delete("rooms/:id/pin")
  @UseGuards(PermissionGuard)
  @RequirePermission("view", "chat-room")
  unpinRoom(@Req() req: AuthenticatedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.prefs.unpin(req.user, id);
  }

  /** PUT /chat/rooms/:id/mute — CHAT-API-025. `{ mutedUntil }`; `null` = bật lại thông báo. */
  @Put("rooms/:id/mute")
  @UseGuards(PermissionGuard)
  @RequirePermission("view", "chat-room")
  muteRoom(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: ChatMuteRoomDto,
  ) {
    return this.prefs.mute(req.user, id, dto);
  }

  /**
   * POST /chat/rooms/:id/unread — CHAT-API-020. Đánh dấu chưa đọc thủ công.
   *
   * `@HttpCode(200)` (không 201): không tạo tài nguyên nào, chỉ bật một cờ trên hàng đã có.
   */
  @Post("rooms/:id/unread")
  @HttpCode(200)
  @UseGuards(PermissionGuard)
  @RequirePermission("view", "chat-room")
  markRoomUnread(@Req() req: AuthenticatedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.prefs.markUnread(req.user, id);
  }

  /** GET /chat/rooms/:id/members — CHAT-API-007a. */
  @Get("rooms/:id/members")
  @UseGuards(PermissionGuard)
  @RequirePermission("view", "chat-room")
  listMembers(@Req() req: AuthenticatedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.members.listMembers(req.user, id);
  }

  /** POST /chat/rooms/:id/members — CHAT-API-007b. Chặn trên phòng dẫn xuất (CHAT-ERR-012). */
  @Post("rooms/:id/members")
  @HttpCode(200)
  @UseGuards(PermissionGuard)
  @RequirePermission("manage", "chat-member")
  addMember(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: AddChatMemberDto,
  ) {
    return this.members.addMember(req.user, id, dto);
  }

  /** PATCH /chat/rooms/:id/members/:userId — CHAT-API-007c. */
  @Patch("rooms/:id/members/:userId")
  @UseGuards(PermissionGuard)
  @RequirePermission("manage", "chat-member")
  updateMember(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("userId", ParseUUIDPipe) userId: string,
    @Body() dto: UpdateChatMemberDto,
  ) {
    return this.members.updateMemberRole(req.user, id, userId, dto);
  }

  /** DELETE /chat/rooms/:id/members/:userId — CHAT-API-007d. Bớt = SET `left_at`, KHÔNG xoá hàng. */
  @Delete("rooms/:id/members/:userId")
  @UseGuards(PermissionGuard)
  @RequirePermission("manage", "chat-member")
  removeMember(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("userId", ParseUUIDPipe) userId: string,
  ) {
    return this.members.removeMember(req.user, id, userId);
  }
}
