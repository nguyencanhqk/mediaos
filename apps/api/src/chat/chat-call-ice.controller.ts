import { Controller, Get, UseGuards } from "@nestjs/common";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";
import { ChatCallIceService } from "./chat-call-ice.service";

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
 */
@Controller("chat")
@UseGuards(PermissionGuard)
export class ChatCallIceController {
  constructor(private readonly svc: ChatCallIceService) {}

  /** `GET /api/v1/chat/calls/ice-config` → `{ iceServers: [...] }`. Không cấu hình TURN ⇒ chỉ STUN. */
  @Get("calls/ice-config")
  @RequirePermission("call", "chat-room")
  getIceConfig() {
    return this.svc.getIceConfig();
  }
}
