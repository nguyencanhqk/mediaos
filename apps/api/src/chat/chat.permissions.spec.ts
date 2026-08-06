import "reflect-metadata";
/**
 * S7-CHAT-BE-GATE-2 — deny-path suite cho cặp quyền của HAI controller CHAT (CHAT-API-001..014, 016).
 *
 * ┌─ VÌ SAO CẦN SUITE NÀY, DÙ ĐÃ CÓ `chat-be1-*`/`chat-be2-*.int-spec.ts` ────────────────────────┐
 * │ Mọi chủ thể trong các int-spec đó được cấp ĐỦ 8 cặp CHAT @Company (hằng `CHAT_FULL`) — chúng   │
 * │ dựng ra để chứng minh "cặp quyền KHÔNG thay được membership", nên cố ý không phân biệt cặp     │
 * │ nào với cặp nào. Hệ quả: hạ cặp của một route GHI xuống `view:chat-room` sẽ không làm ĐỎ bất   │
 * │ kỳ test nào — người chỉ có quyền xem sẽ ghim/thu hồi/quản trị thành viên được, và cả bộ suite  │
 * │ vẫn xanh. Đây là suite duy nhất soi CHÍNH cặp quyền.                                           │
 * │ Thêm nữa: `PermissionGuard` là **opt-in per-route** ở dự án này (memory                        │
 * │ `s1-fnd-module-metadata-seed-drift`) — quên `@UseGuards` là route MỞ cho mọi user đã đăng      │
 * │ nhập, IM LẶNG. Ca "không route nào thiếu guard" ở dưới gác đúng chỗ đó.                        │
 * └────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Gọi thẳng `PermissionGuard` với metadata THẬT của controller (Reflector thật) → enforcement
 * end-to-end mà không cần boot Nest/DB. Mẫu: `tasks.permissions.spec.ts` · `org.permissions.spec.ts`.
 */
import { ForbiddenException, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";
import { ChatFilesController } from "./chat-files.controller";
import { ChatMessagesController } from "./chat-messages.controller";
import { ChatSearchController } from "./chat-search.controller";
import { ChatRoomsController } from "./chat-rooms.controller";
import { PermissionGuard } from "../permission/guards/permission.guard";
import {
  REQUIRE_PERMISSION,
  type RequirePermissionMeta,
} from "../permission/require-permission.decorator";
import type { PermissionDecision } from "../permission/permission.types";

const USER = {
  id: "11111111-1111-1111-1111-111111111111",
  companyId: "22222222-2222-2222-2222-222222222222",
};

const ALLOW: PermissionDecision = { allow: true, reason: "allow", auditRequired: false };
const DENY: PermissionDecision = { allow: false, reason: "deny-default", auditRequired: false };

type AnyChatController =
  | typeof ChatRoomsController
  | typeof ChatMessagesController
  | typeof ChatSearchController
  | typeof ChatFilesController;

interface RouteGate {
  controller: AnyChatController;
  handlerName: string;
  action: string;
  resourceType: string;
  /** Cả 8 cặp CHAT thường đều `is_sensitive=false` ở seed `0538:406-415`. */
  isSensitive?: boolean;
}

/**
 * Cặp quyền theo API-13 §5.1 + seed mig `0538`. Bảng này là **HỢP ĐỒNG**, không phải ảnh chụp: sửa một
 * dòng ở đây phải có lý do nghiệp vụ viết kèm, y như sửa SPEC.
 */
// Giữ dạng BẢNG (một dòng = một route) là có chủ đích: prettier bung mỗi mục thành 6 dòng, bảng dài
// gấp 6 và mất khả năng đọc-quét theo cột — thứ khiến một cặp quyền sai đập vào mắt. Directive dưới đây
// phải đứng SÁT node và không kèm chữ nào khác thì prettier mới nhận.
/**
 * MỌI controller của module CHAT — nguồn DUY NHẤT cho ba ca cấp-module bên dưới.
 *
 * ⚠️ Trước `S7-CHAT-BE-4`, ba ca đó lặp CỨNG `[ChatRoomsController, ChatMessagesController]`. Khi WO này
 * thêm `ChatSearchController`, route mới đứng ngoài **cả ba** lưới ("route mới phải khai cặp" · "0 route
 * thiếu `@RequirePermission`" · "không controller nào dùng `chat-oversight`") mà không ca nào đỏ — tức
 * suite tự nhận là "nơi DUY NHẤT soi chính cặp quyền" lại mù với controller mới nhất. Gom về một hằng để
 * lần sau quên là **lỗi biên dịch/đỏ ngay**, không phải im lặng.
 *
 * ⚠️ `S7-CHAT-BE-7` (`/chat/oversight/*`) sẽ có controller RIÊNG dùng cặp `('view','chat-oversight')` —
 * controller ĐÓ **không** được thêm vào danh sách này (ca thứ ba sẽ đỏ đúng như thiết kế); nó cần bảng
 * gate riêng của WO ấy.
 */
const CHAT_CONTROLLERS = [
  ChatRoomsController,
  ChatMessagesController,
  ChatSearchController,
  // S7-CHAT-BE-8 — `/chat/files/*`. Đây là controller GHI DUY NHẤT của module không đi qua
  // `assertMember` (tệp chưa thuộc phòng nào lúc register), nên cặp quyền của nó là thứ duy nhất đứng
  // giữa "người dùng thường đính kèm được" và "ai đăng nhập cũng ghi được vào bảng `files`".
  ChatFilesController,
] as const;

// prettier-ignore
const ROUTE_GATES: readonly RouteGate[] = [
  // ── ChatRoomsController (CHAT-API-001..008) ──
  { controller: ChatRoomsController, handlerName: "listRooms", action: "view", resourceType: "chat-room" },
  { controller: ChatRoomsController, handlerName: "createRoom", action: "create", resourceType: "chat-room" },
  { controller: ChatRoomsController, handlerName: "openDirect", action: "create", resourceType: "chat-room" },
  { controller: ChatRoomsController, handlerName: "getRoom", action: "view", resourceType: "chat-room" },
  { controller: ChatRoomsController, handlerName: "updateRoom", action: "update", resourceType: "chat-room" },
  { controller: ChatRoomsController, handlerName: "archiveRoom", action: "archive", resourceType: "chat-room" },
  // CHAT-API-008 — rời phòng là thao tác trên tư cách CỦA CHÍNH MÌNH. Gắn `manage:chat-member` vào đây
  // sẽ NHỐT nhân viên thường trong mọi phòng họ được thêm vào (API-13 §5.1 + jsdoc controller).
  { controller: ChatRoomsController, handlerName: "leaveRoom", action: "view", resourceType: "chat-room" },
  { controller: ChatRoomsController, handlerName: "listMembers", action: "view", resourceType: "chat-room" },
  { controller: ChatRoomsController, handlerName: "addMember", action: "manage", resourceType: "chat-member" },
  { controller: ChatRoomsController, handlerName: "updateMember", action: "manage", resourceType: "chat-member" },
  { controller: ChatRoomsController, handlerName: "removeMember", action: "manage", resourceType: "chat-member" },
  // CHAT-API-023 (S8-CHAT-UX-RT-1) — "đang gõ". Cặp GHI `send:chat-message`, KHÔNG phải `view:chat-room`:
  // "đang gõ" là lời hứa sắp GỬI. Ai chỉ đọc được mà báo được đang gõ thì màn hình hiện một tin nhắn sẽ
  // không bao giờ tới. Cặp này TRÙNG `sendMessage` có chủ đích — cùng một năng lực.
  { controller: ChatRoomsController, handlerName: "typing", action: "send", resourceType: "chat-message" },
  // CHAT-API-024a/b · 025 · 020 (S8-CHAT-UX-BE-1) — ghim · tắt thông báo · đánh dấu chưa đọc.
  // Cặp ĐỌC `view:chat-room`, NGƯỢC với `typing` ngay trên: ba thứ này ghi lên hàng membership CỦA
  // CHÍNH MÌNH, không phải năng lực gửi. Gắn `update:chat-room` sẽ đẻ ra role "đọc được phòng mà không
  // tắt nổi thông báo của chính mình" — tuỳ chọn cá nhân KHÔNG được nằm sau cổng quyền quản trị
  // (memory `personal-prefs-must-not-sit-behind-permission-gate` · API-13 §5.1b ghi chú).
  { controller: ChatRoomsController, handlerName: "pinRoom", action: "view", resourceType: "chat-room" },
  { controller: ChatRoomsController, handlerName: "unpinRoom", action: "view", resourceType: "chat-room" },
  { controller: ChatRoomsController, handlerName: "muteRoom", action: "view", resourceType: "chat-room" },
  { controller: ChatRoomsController, handlerName: "markRoomUnread", action: "view", resourceType: "chat-room" },

  // ── ChatMessagesController (CHAT-API-009..014, 016) ──
  { controller: ChatMessagesController, handlerName: "unreadCount", action: "view", resourceType: "chat-room" },
  { controller: ChatMessagesController, handlerName: "listMessages", action: "view", resourceType: "chat-room" },
  { controller: ChatMessagesController, handlerName: "sendMessage", action: "send", resourceType: "chat-message" },
  { controller: ChatMessagesController, handlerName: "listPinned", action: "view", resourceType: "chat-room" },
  // CHAT-API-017 (S7-CHAT-BE-3) — tab "Tệp". Cặp PHẢI trùng `listMessages` **và** trùng cặp mà
  // `ChatMessageFileResolver.canRead` hỏi: `data_scope` là per-(permission, role), nên ba chỗ lệch nhau
  // sẽ đẻ ra role "thấy danh sách tệp mà tải không được" (API-13 §6 nguyên tắc 3).
  { controller: ChatMessagesController, handlerName: "listRoomFiles", action: "view", resourceType: "chat-room" },
  // ── ChatSearchController (CHAT-API-015) ──
  // Cặp TRÙNG NGUYÊN VĂN cặp đường đọc tin. Cặp riêng (vd `search:chat-message`) đẻ role "tìm được mà
  // đọc không được"; cặp CHƯA SEED thì guard hỏi một permission không tồn tại ⇒ 403 cho MỌI người =
  // tính năng chết trong im lặng.
  { controller: ChatSearchController, handlerName: "searchMessages", action: "view", resourceType: "chat-room" },
  // CHAT-API-014 — đánh dấu đã đọc là thao tác trên trạng thái ĐỌC của chính mình, KHÔNG phải gửi tin.
  // Gắn `send:chat-message` vào đây làm người chỉ có quyền xem không bao giờ tắt được badge.
  { controller: ChatMessagesController, handlerName: "markRead", action: "view", resourceType: "chat-room" },
  // ⚠️ `send` / `recall` / `pin` × `chat-message` là BA cặp KHÁC NHAU (jsdoc controller): được gửi tin
  // không đương nhiên được thu hồi tin người khác hay ghim.
  { controller: ChatMessagesController, handlerName: "recall", action: "recall", resourceType: "chat-message" },
  { controller: ChatMessagesController, handlerName: "pin", action: "pin", resourceType: "chat-message" },
  { controller: ChatMessagesController, handlerName: "unpin", action: "pin", resourceType: "chat-message" },

  // ── ChatFilesController (S7-CHAT-BE-8 — SPEC-15 §13.5 bước 1-2) ──
  // Cặp `send:chat-message`, KHÔNG phải `view:chat-room`: đây là hai bước ĐẦU của luồng GỬI tin, người
  // chỉ có quyền xem không được tạo tệp mới trong tenant. Cặp này TRÙNG NGUYÊN VĂN cặp mà
  // `ChatMessageFileResolver.canLink` hỏi ở bước 3 — lệch nhau sẽ đẻ role "tải lên được mà gắn không được".
  { controller: ChatFilesController, handlerName: "createUploadUrl", action: "send", resourceType: "chat-message" },
  { controller: ChatFilesController, handlerName: "confirmUpload", action: "send", resourceType: "chat-message" },
];

function handlerOf(controller: AnyChatController, name: string): (...args: unknown[]) => unknown {
  const fn = (controller.prototype as unknown as Record<string, unknown>)[name];
  if (typeof fn !== "function") throw new Error(`${controller.name}.${name} không tồn tại`);
  return fn as (...args: unknown[]) => unknown;
}

function routeMethodsOf(controller: AnyChatController): string[] {
  return Object.getOwnPropertyNames(controller.prototype).filter((n) => n !== "constructor");
}

function ctxFor(controller: AnyChatController, name: string): ExecutionContext {
  const handler = handlerOf(controller, name);
  return {
    switchToHttp: () => ({ getRequest: () => ({ user: USER, params: {} }) }),
    getHandler: () => handler,
    getClass: () => controller,
  } as unknown as ExecutionContext;
}

describe("CHAT controllers — cặp quyền per-route (S7-CHAT-BE-GATE-2)", () => {
  let permSvc: { can: ReturnType<typeof vi.fn> };
  let guard: PermissionGuard;

  beforeEach(() => {
    permSvc = { can: vi.fn() };
    guard = new PermissionGuard(new Reflector(), permSvc as never);
  });

  describe.each(ROUTE_GATES)(
    "$controller.name.$handlerName → $action:$resourceType",
    ({ controller, handlerName, action, resourceType, isSensitive }) => {
      it("khai @RequirePermission ĐÚNG cặp + đúng độ nhạy cảm (seed 0538)", () => {
        const meta = Reflect.getMetadata(REQUIRE_PERMISSION, handlerOf(controller, handlerName)) as
          | RequirePermissionMeta
          | undefined;
        expect(meta).toBeDefined();
        expect(meta).toMatchObject({ action, resourceType });
        expect(meta?.isSensitive ?? false).toBe(isSensitive ?? false);
      });

      it("được bọc bởi PermissionGuard (@UseGuards) — guard là OPT-IN, quên = route MỞ", () => {
        const guards =
          (Reflect.getMetadata("__guards__", handlerOf(controller, handlerName)) as unknown[]) ??
          [];
        expect(guards).toContain(PermissionGuard);
      });

      it("DENY: thiếu quyền → 403, và hỏi ĐÚNG cặp", async () => {
        permSvc.can.mockResolvedValue(DENY);
        await expect(guard.canActivate(ctxFor(controller, handlerName))).rejects.toBeInstanceOf(
          ForbiddenException,
        );
        expect(permSvc.can).toHaveBeenCalledWith(
          expect.objectContaining({
            action,
            resourceType,
            userId: USER.id,
            companyId: USER.companyId,
          }),
        );
      });

      it("ALLOW: có quyền → qua guard", async () => {
        permSvc.can.mockResolvedValue(ALLOW);
        await expect(guard.canActivate(ctxFor(controller, handlerName))).resolves.toBe(true);
      });
    },
  );

  // ── Ba ca cấp MODULE — bảng ở trên không tự bắt được ba lớp lỗi này ─────────

  it("KHÔNG route nào của 2 controller đứng ngoài bảng (route mới phải khai cặp)", () => {
    const declared = new Set(ROUTE_GATES.map((g) => `${g.controller.name}.${g.handlerName}`));
    const missing: string[] = [];
    for (const controller of CHAT_CONTROLLERS) {
      for (const name of routeMethodsOf(controller)) {
        if (!declared.has(`${controller.name}.${name}`)) missing.push(`${controller.name}.${name}`);
      }
    }
    expect(missing, `route chưa khai cặp quyền trong ROUTE_GATES: ${missing.join(", ")}`).toEqual(
      [],
    );
  });

  it("0 route CHAT nào không có @RequirePermission (không có 'read mở' ở module này)", () => {
    const open: string[] = [];
    for (const controller of CHAT_CONTROLLERS) {
      for (const name of routeMethodsOf(controller)) {
        const meta = Reflect.getMetadata(REQUIRE_PERMISSION, handlerOf(controller, name));
        if (!meta) open.push(`${controller.name}.${name}`);
      }
    }
    // CHAT không có route "mở cho mọi user tenant" nào: kể cả `/unread-count` (tự-bound theo actor)
    // vẫn phải qua `view:chat-room`, vì nó tiết lộ có bao nhiêu phòng đang có tin cho người này.
    expect(open, `route CHAT thiếu cặp quyền: ${open.join(", ")}`).toEqual([]);
  });

  it("KHÔNG controller nào ở đây dùng `chat-oversight` — đường đọc-vượt là BE-7, path riêng", () => {
    // CHAT-DEC-004: Super Admin đọc mọi phòng qua cặp RIÊNG `('view','chat-oversight')` (is_sensitive=true,
    // `0538:419`) trên controller RIÊNG `/chat/oversight/*`. Cặp đó rơi vào một route ở đây là mất tính
    // chất "đường đọc thường gọi assertMember vô điều kiện" (API-13 §5.3 ràng buộc 1).
    const offenders: string[] = [];
    for (const controller of CHAT_CONTROLLERS) {
      for (const name of routeMethodsOf(controller)) {
        const meta = Reflect.getMetadata(REQUIRE_PERMISSION, handlerOf(controller, name)) as
          | RequirePermissionMeta
          | undefined;
        if (meta?.resourceType === "chat-oversight") offenders.push(`${controller.name}.${name}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("mọi cặp dùng ở đây nằm trong 9 cặp CHAT thường đã seed (0538) — không cặp bịa", () => {
    const SEEDED = new Set([
      "access:chat",
      "view:chat-room",
      "create:chat-room",
      "update:chat-room",
      "archive:chat-room",
      "manage:chat-member",
      "send:chat-message",
      "recall:chat-message",
      "pin:chat-message",
    ]);
    const unknown = ROUTE_GATES.map((g) => `${g.action}:${g.resourceType}`).filter(
      (p) => !SEEDED.has(p),
    );
    // Cặp không có trong catalog = `PermissionService.can` không bao giờ trả ALLOW ⇒ route CHẾT 403
    // với mọi role, kể cả role đúng ra phải dùng được.
    expect([...new Set(unknown)], `cặp chưa seed: ${unknown.join(", ")}`).toEqual([]);
  });
});
