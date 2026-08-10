import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";
import { ChatCallIceService } from "./chat-call-ice.service";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * S7-CALL-BE-1 — `CHAT-API-029` (`GET /chat/calls/ice-config`).
 *
 * ┌─ VÌ SAO TÁCH KHỎI `ChatCallsController` ────────────────────────────────────────────────────────┐
 * │ Route này là NGOẠI LỆ ba mặt so với 5 route vòng đời, và đứng chung sẽ làm mờ cả ba:             │
 * │   • KHÔNG nhận `roomId`/`callId` ⇒ **KHÔNG** đi qua `assertMember`/`assertCallAccess` (API-13    │
 * │     ghi `—` ở cột Membership). Cặp quyền là hàng rào DUY NHẤT của nó.                            │
 * │   • KHÔNG chạm DB — không `withTenant`, không audit (không có hành động nghiệp vụ nào xảy ra).   │
 * │   • Là route DUY NHẤT của module gọi RA INTERNET và chạm SECRET (BẤT BIẾN #3).                   │
 * │ Cùng lý do `ChatSearchController` (ngoại lệ membership) và `ChatFilesController` (đường ghi tệp) │
 * │ được tách ra khỏi controller chính.                                                              │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Gate `('call','chat-room')` — cùng cặp với vòng đời: ai không được phép gọi thì cũng không cần biết
 * hạ tầng TURN của công ty nằm ở đâu. Credential trả về là **dẫn xuất, hạn ngắn**; secret gốc không bao
 * giờ rời server (xem `ChatCallIceService`).
 *
 * ⚠️ S7-CALL-SEC-1: `req.user` giờ ĐƯỢC truyền xuống service — KHÔNG phải để đọc dữ liệu theo actor
 * (route này vẫn không nhận `roomId`/`callId`, vẫn không `assertMember`), mà để khoá **cooldown đúc
 * credential** theo (company, user) và gắn **company** vào bộ đếm "Cloudflare từ chối liên tiếp" cho
 * dòng cảnh báo best-effort (xem jsdoc `ChatCallIceService`). `req.user.id` KHÔNG được log ở đường này.
 */
@Controller("chat")
@UseGuards(PermissionGuard)
export class ChatCallIceController {
  constructor(private readonly svc: ChatCallIceService) {}

  /** `GET /api/v1/chat/calls/ice-config` → `{ iceServers: [...] }`. Không cấu hình TURN ⇒ chỉ STUN. */
  @Get("calls/ice-config")
  @RequirePermission("call", "chat-room")
  getIceConfig(@Req() req: AuthenticatedRequest) {
    return this.svc.getIceConfig(req.user);
  }
}
