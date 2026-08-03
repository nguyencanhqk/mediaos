import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
  UseGuards,
  UsePipes,
} from "@nestjs/common";
import { ZodValidationPipe } from "nestjs-zod";
import type { Request } from "express";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";
import { ChatOversightAuditGuard } from "./chat-oversight-audit.guard";
import { ChatOversightService } from "./chat-oversight.service";
import {
  ChatOversightAuditQueryDto,
  ChatOversightMessagesQueryDto,
  ChatOversightRoomQueryDto,
} from "./chat.dto";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * S7-CHAT-BE-7 🔒 — `ChatOversightController`: ĐỌC-VƯỢT MEMBERSHIP (CHAT-API-018a/b/c + 019).
 * CHAT-DEC-004 (owner chốt 02/08/2026, **NGƯỢC** đề xuất Draft) · SPEC-15 §3.3 · API-13 §5.3.
 *
 * ┌─ ĐÂY LÀ BỀ MẶT RỦI RO LỚN NHẤT CỦA MODULE — ĐỌC HẾT KHỐI NÀY TRƯỚC KHI SỬA ──────────────────────┐
 * │ Mọi route ở đây đọc được phòng mà người gọi **KHÔNG** là thành viên. Đó là chức năng, không phải  │
 * │ lỗ. Nó được đóng khung bằng SÁU vế, mất vế nào cũng là mở lỗ đọc toàn cục:                        │
 * │   1. **Cặp quyền RIÊNG** `('view','chat-oversight')` — KHÔNG nới scope của `('view','chat-room')`.│
 * │      Nhờ vậy toàn bộ đường đọc thường giữ nguyên tính chất "gọi `assertMember` VÔ ĐIỀU KIỆN", chỉ │
 * │      file này phải chứng minh. Grep `chat-access.service.ts`: 0 chữ `oversight`.                   │
 * │   2. **Path + controller + service + repository + mapper RIÊNG.** Không handler nào của            │
 * │      CHAT-API-001/004/009 mang cờ `isOversight` (ràng buộc 1).                                     │
 * │   3. **CHỈ ĐỌC** — 4 route, tất cả `GET`. Không `POST`/`PATCH`/`DELETE` nào dưới `/chat/oversight/`│
 * │      (ràng buộc 4): người đọc-vượt KHÔNG gửi/ghim/thu hồi/sửa thành viên được.                     │
 * │   4. **Audit hai mô hình transaction** — xem `ChatOversightService` và `ChatOversightAuditGuard`.  │
 * │   5. **KHÔNG mở tìm kiếm**: không có `/chat/oversight/search`. `/chat/search` giữ nguyên vị từ     │
 * │      membership cho MỌI role (ràng buộc 5). Thêm vào là mở lại CHAT-DEC-004 với owner.             │
 * │   6. **KHÔNG cấp quyền tải tệp**: `ChatMessageFileResolver` mù với cặp này, và DTO `018c` trả      │
 * │      metadata tệp **không kèm URL ký** (ràng buộc 7).                                              │
 * └───────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ **HAI GUARD, ĐÚNG THỨ TỰ** trên MỌI route — `@UseGuards(ChatOversightAuditGuard, PermissionGuard)`.
 * `ChatOversightAuditGuard` chạy trước, tự hỏi `PermissionService.can()`, thấy deny thì ghi `audit_logs`
 * `Denied` ở transaction RIÊNG ĐÃ COMMIT rồi `return true` để **`PermissionGuard` mới là bên ném 403**.
 * Đảo thứ tự = mất dòng audit từ chối (`PermissionGuard` ném trước, guard audit không bao giờ chạy).
 * Bỏ `PermissionGuard` = ĐỎ `route-guard-coverage.e2e-spec` ("@RequirePermission trang trí").
 *
 * ⚠️ `{ isSensitive: true }` phải khớp seed THẬT (`0538:419` — cặp DUY NHẤT của CHAT có `is_sensitive`).
 * Thiếu cờ này thì `can()` chấp nhận grant wildcard `*:*` ⇒ mọi người giữ wildcard đọc được mọi phòng.
 *
 * ⚠️ `@Controller("chat")` + path `oversight/*` (KHÔNG `@Controller("chat/oversight")`): census route đọc
 * `controllerPath` để dựng đường dẫn đầy đủ; giữ cùng khuôn với 3 controller CHAT kia làm diff census
 * đọc được. Không có route `:id` nào ở CẤP `chat/` trong file này nên không có xung đột thứ tự route.
 */
@Controller("chat")
@UsePipes(ZodValidationPipe)
export class ChatOversightController {
  constructor(private readonly oversight: ChatOversightService) {}

  /**
   * GET /chat/oversight/rooms — CHAT-API-018a. Tra phòng theo mã/tên/loại, trả **siêu dữ liệu**.
   *
   * ⚠️ Hẹp hơn "liệt kê mọi phòng" bằng ba vế (API-13 §5.3): `q` bắt buộc ≥2 ký tự · trần trang + cờ
   * `truncated` · audit ghi tiêu chí tìm. Và payload **không có danh sách thành viên** — thiếu vế đó thì
   * một lời gọi xuất được đồ thị "ai nhắn riêng với ai" của cả công ty, rộng hơn hẳn ngoại lệ owner chốt
   * ("mở ĐÍCH DANH một phòng").
   */
  @Get("oversight/rooms")
  @UseGuards(ChatOversightAuditGuard, PermissionGuard)
  @RequirePermission("view", "chat-oversight", { isSensitive: true })
  searchRooms(@Req() req: AuthenticatedRequest, @Query() query: ChatOversightRoomQueryDto) {
    return this.oversight.searchRooms(req.user, query);
  }

  /**
   * GET /chat/oversight/rooms/:id — CHAT-API-018b. Chi tiết phòng + thành viên. Audit MỖI LẦN GỌI.
   *
   * Phòng lạ / đã xoá mềm / tenant khác ⇒ **404 GIỐNG HỆT** đường đọc thường (hằng `ROOM_NOT_FOUND`) —
   * chính đường quản trị cũng không được là oracle dò sự tồn tại của phòng.
   */
  @Get("oversight/rooms/:id")
  @UseGuards(ChatOversightAuditGuard, PermissionGuard)
  @RequirePermission("view", "chat-oversight", { isSensitive: true })
  getRoom(@Req() req: AuthenticatedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.oversight.getRoom(req.user, id);
  }

  /**
   * GET /chat/oversight/rooms/:id/messages — CHAT-API-018c. Con trỏ RIÊNG, **toàn dải `room_seq`**.
   *
   * ⚠️ KHÔNG tái dùng truy vấn có JOIN `chat_room_members` (ràng buộc 8): người đọc-vượt không có hàng
   * membership nên vị từ dùng chung `visible_from_seq` (SPEC-15 §13.4) sẽ trả **RỖNG** — hỏng lặng lẽ
   * theo chiều ngược lại, nhìn giống "phòng không có tin" chứ không giống lỗi quyền.
   */
  @Get("oversight/rooms/:id/messages")
  @UseGuards(ChatOversightAuditGuard, PermissionGuard)
  @RequirePermission("view", "chat-oversight", { isSensitive: true })
  listMessages(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Query() query: ChatOversightMessagesQueryDto,
  ) {
    return this.oversight.listMessages(req.user, id, query);
  }

  /**
   * GET /chat/oversight/audit — CHAT-API-019. Nhật ký đọc-vượt (CHAT-SCREEN-008).
   *
   * ⚠️ Truy vấn BÓ `action = 'chat.oversight.read'` **AND** `module_code = 'CHAT'`. Không bó là biến MỘT
   * cặp quyền CHAT thành **cổng đọc `audit_logs` toàn hệ thống** — bảng dùng chung đang phục vụ điều tra
   * AUTH/HR/LEAVE.
   *
   * ⚠️ Route này **KHÔNG** sinh dòng audit `Success` (API-13 §5.3 bảng endpoint, cột Audit = `—`): đọc
   * nhật ký không tiết lộ một byte nội dung chat nào. Nhưng nó VẪN mang `ChatOversightAuditGuard` để
   * đường TỪ CHỐI đồng nhất trên cả 4 route — "mọi 403 dưới `/chat/oversight/*` để lại đúng 1 dòng
   * `Denied`" là bất biến khẳng định được trong một câu, và một route được miễn là một route sẽ bị quên.
   */
  @Get("oversight/audit")
  @UseGuards(ChatOversightAuditGuard, PermissionGuard)
  @RequirePermission("view", "chat-oversight", { isSensitive: true })
  listAudit(@Req() req: AuthenticatedRequest, @Query() query: ChatOversightAuditQueryDto) {
    return this.oversight.listAudit(req.user, query);
  }
}
