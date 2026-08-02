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
import { ChatMessagesController } from "./chat-messages.controller";
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

type AnyChatController = typeof ChatRoomsController | typeof ChatMessagesController;

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

  // ── ChatMessagesController (CHAT-API-009..014, 016) ──
  { controller: ChatMessagesController, handlerName: "unreadCount", action: "view", resourceType: "chat-room" },
  { controller: ChatMessagesController, handlerName: "listMessages", action: "view", resourceType: "chat-room" },
  { controller: ChatMessagesController, handlerName: "sendMessage", action: "send", resourceType: "chat-message" },
  { controller: ChatMessagesController, handlerName: "listPinned", action: "view", resourceType: "chat-room" },
  // CHAT-API-014 — đánh dấu đã đọc là thao tác trên trạng thái ĐỌC của chính mình, KHÔNG phải gửi tin.
  // Gắn `send:chat-message` vào đây làm người chỉ có quyền xem không bao giờ tắt được badge.
  { controller: ChatMessagesController, handlerName: "markRead", action: "view", resourceType: "chat-room" },
  // ⚠️ `send` / `recall` / `pin` × `chat-message` là BA cặp KHÁC NHAU (jsdoc controller): được gửi tin
  // không đương nhiên được thu hồi tin người khác hay ghim.
  { controller: ChatMessagesController, handlerName: "recall", action: "recall", resourceType: "chat-message" },
  { controller: ChatMessagesController, handlerName: "pin", action: "pin", resourceType: "chat-message" },
  { controller: ChatMessagesController, handlerName: "unpin", action: "pin", resourceType: "chat-message" },
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
          (Reflect.getMetadata("__guards__", handlerOf(controller, handlerName)) as unknown[]) ?? [];
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
    for (const controller of [ChatRoomsController, ChatMessagesController] as const) {
      for (const name of routeMethodsOf(controller)) {
        if (!declared.has(`${controller.name}.${name}`)) missing.push(`${controller.name}.${name}`);
      }
    }
    expect(
      missing,
      `route chưa khai cặp quyền trong ROUTE_GATES: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("0 route CHAT nào không có @RequirePermission (không có 'read mở' ở module này)", () => {
    const open: string[] = [];
    for (const controller of [ChatRoomsController, ChatMessagesController] as const) {
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
    for (const controller of [ChatRoomsController, ChatMessagesController] as const) {
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
