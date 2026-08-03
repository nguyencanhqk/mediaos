import { Controller, Get, Query, Req, UseGuards, UsePipes } from "@nestjs/common";
import { ZodValidationPipe } from "nestjs-zod";
import type { Request } from "express";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";
import { ChatSearchService } from "./chat-search.service";
import { ChatSearchQueryDto } from "./chat.dto";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * S7-CHAT-BE-4 — CHAT-API-015. Controller RIÊNG cho đúng một route, có chủ đích.
 *
 * ┌─ VÌ SAO TÁCH FILE ─────────────────────────────────────────────────────────────────────────────┐
 * │ Tìm kiếm là **ngoại lệ membership duy nhất** của module: mọi route trong                        │
 * │ `ChatMessagesController` bó theo một `roomId` đã đi qua `ChatAccessService.assertMember`, còn   │
 * │ route này quét toàn bộ `chat_messages` của tenant rồi mới lọc bằng vị từ trong truy vấn.        │
 * │ Để nó nằm lẫn giữa 8 route kia là làm MẤT TÍN HIỆU — người đọc file đó sẽ mặc định "route nào ở │
 * │ đây cũng qua điểm khẳng định". File riêng làm ngoại lệ **grep được**.                            │
 * └────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ `@UsePipes(ZodValidationPipe)` là BẮT BUỘC, không phải sao chép máy móc: thiếu nó thì `q`/`limit`/
 * `cursor` **không được validate gì cả** — mọi trần khai trong `chatSearchQuerySchema` (≥2 ký tự, ≤200,
 * limit ≤50, NFC) thành trang trí, và một câu 10KB đi thẳng vào `websearch_to_tsquery`.
 */
@Controller("chat")
@UsePipes(ZodValidationPipe)
export class ChatSearchController {
  constructor(private readonly search: ChatSearchService) {}

  /**
   * GET /chat/search — CHAT-API-015.
   *
   * Cặp `view:chat-room` — **TRÙNG NGUYÊN VĂN** cặp của `listMessages`, `listPinned`, `listRoomFiles` và
   * của `ChatMessageFileResolver`. API-13 §6 nguyên tắc 3: `data_scope` là per-(permission, role), nên
   * tách một cặp riêng cho tìm kiếm (ví dụ `('search','chat-message')`) sẽ đẻ ra role "tìm được mà đọc
   * không được" — hoặc ngược lại (memory `read-path-gate-pair-must-match-download-pair`).
   *
   * ⚠️ Cặp `('view','chat-oversight')` **KHÔNG** áp ở đây và không được thêm: SPEC-15 §3.3 chốt tìm kiếm
   * giữ nguyên vị từ membership cho MỌI role, kể cả Super Admin. Thêm vào là mở lại CHAT-DEC-004 với owner.
   */
  @Get("search")
  @UseGuards(PermissionGuard)
  @RequirePermission("view", "chat-room")
  searchMessages(@Req() req: AuthenticatedRequest, @Query() query: ChatSearchQueryDto) {
    return this.search.search(req.user, query);
  }
}
