import "reflect-metadata";
/**
 * S7-CHAT-BE-7 🔒 — suite gate RIÊNG cho `ChatOversightController` (CHAT-API-018/019).
 *
 * ┌─ VÌ SAO KHÔNG GỘP VÀO `chat.permissions.spec.ts` ────────────────────────────────────────────────┐
 * │ File đó có một ca khẳng định "KHÔNG controller nào ở đây dùng `chat-oversight`" — và đó là một     │
 * │ khẳng định ĐÚNG mà WO này phải giữ nguyên (API-13 §5.3 ràng buộc 1). Thêm controller đọc-vượt vào  │
 * │ hằng `CHAT_CONTROLLERS` của nó sẽ làm ca ấy đỏ; hạ ca ấy để "cho xanh" là xoá đúng cái lưới đang   │
 * │ canh việc cặp đọc-vượt không rơi vào một route thường. Suite riêng ⇒ hai lưới cùng sống.           │
 * └───────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Gọi THẲNG guard thật với metadata THẬT của controller (Reflector thật) → enforcement end-to-end mà
 * không cần boot Nest/DB. Mẫu: `chat.permissions.spec.ts`.
 *
 * ⚠️ Chủ thể ở đây là một `USER` bịa với quyết định `can()` do test điều khiển — CỐ Ý **không** dùng
 * Super Admin: SA có `*:*` và được grant toàn bộ catalog nên mọi ca deny sẽ xanh-giả kể cả khi guard khai
 * sai resource hoặc quên hẳn (memory `superadmin-not-a-canonical-role`).
 */
import { ForbiddenException, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatOversightController } from "./chat-oversight.controller";
import { ChatOversightAuditGuard } from "./chat-oversight-audit.guard";
import { PermissionGuard } from "../permission/guards/permission.guard";
import {
  REQUIRE_PERMISSION,
  type RequirePermissionMeta,
} from "../permission/require-permission.decorator";
import type { PermissionDecision } from "../permission/permission.types";
import {
  __SENSITIVE_CAPABILITY_ALLOWLIST_FOR_TEST,
  SENSITIVE_SCREEN_GATE_PAIRS,
} from "../permission/permission.service";
import { CHAT_AUDIT, CHAT_MODULE_CODE } from "./chat.errors";

const USER = {
  id: "11111111-1111-1111-1111-111111111111",
  companyId: "22222222-2222-2222-2222-222222222222",
};
const ROOM_ID = "33333333-3333-3333-3333-333333333333";

const ALLOW: PermissionDecision = { allow: true, reason: "allow", auditRequired: false };
const DENY: PermissionDecision = { allow: false, reason: "deny-default", auditRequired: true };

/**
 * Bốn route của WO. Bảng này là **HỢP ĐỒNG**: sửa một dòng phải có lý do nghiệp vụ viết kèm, y như sửa SPEC.
 * Cả bốn dùng CÙNG một cặp — đó là chủ đích (một cặp duy nhất mở toàn bộ ngoại lệ, SPEC-15 §3.3).
 */
const ROUTE_GATES = [
  { handlerName: "searchRooms", routePath: "/chat/oversight/rooms", endpoint: "018a" },
  { handlerName: "getRoom", routePath: "/chat/oversight/rooms/:id", endpoint: "018b" },
  {
    handlerName: "listMessages",
    routePath: "/chat/oversight/rooms/:id/messages",
    endpoint: "018c",
  },
  { handlerName: "listAudit", routePath: "/chat/oversight/audit", endpoint: "019" },
] as const;

const OVERSIGHT_PAIR = { action: "view", resourceType: "chat-oversight" } as const;

function handlerOf(name: string): (...args: unknown[]) => unknown {
  const fn = (ChatOversightController.prototype as unknown as Record<string, unknown>)[name];
  if (typeof fn !== "function") throw new Error(`ChatOversightController.${name} không tồn tại`);
  return fn as (...args: unknown[]) => unknown;
}

function routeMethodNames(): string[] {
  return Object.getOwnPropertyNames(ChatOversightController.prototype).filter(
    (n) => n !== "constructor",
  );
}

interface CtxOpts {
  params?: Record<string, string>;
  routePath?: string;
  viaApiKey?: boolean;
  scopeKeys?: string[];
  noUser?: boolean;
}

function ctxFor(name: string, opts: CtxOpts = {}): ExecutionContext {
  const handler = handlerOf(name);
  const user = opts.noUser
    ? undefined
    : { ...USER, viaApiKey: opts.viaApiKey, scopeKeys: opts.scopeKeys };
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        user,
        params: opts.params ?? {},
        route: { path: opts.routePath },
      }),
    }),
    getHandler: () => handler,
    getClass: () => ChatOversightController,
  } as unknown as ExecutionContext;
}

describe("ChatOversightController — cặp quyền + hai guard (S7-CHAT-BE-7)", () => {
  describe.each(ROUTE_GATES)("$handlerName ($routePath)", ({ handlerName }) => {
    it("khai @RequirePermission ĐÚNG cặp `view:chat-oversight` + `isSensitive: true`", () => {
      const meta = Reflect.getMetadata(REQUIRE_PERMISSION, handlerOf(handlerName)) as
        | RequirePermissionMeta
        | undefined;
      expect(meta).toBeDefined();
      expect(meta).toMatchObject(OVERSIGHT_PAIR);
      // ⚠️ Thiếu `isSensitive` thì `can()` chấp nhận grant wildcard `*:*` ⇒ MỌI người giữ wildcard đọc
      // được mọi phòng — đúng lỗ mà cặp riêng dựng ra để chặn. Seed THẬT: `0538:419` `is_sensitive=true`.
      expect(meta?.isSensitive).toBe(true);
    });

    it("có CẢ HAI guard, `ChatOversightAuditGuard` đứng TRƯỚC `PermissionGuard`", () => {
      const guards = (Reflect.getMetadata("__guards__", handlerOf(handlerName)) as unknown[]) ?? [];
      // Đảo thứ tự = `PermissionGuard` ném 403 trước ⇒ guard audit KHÔNG BAO GIỜ chạy ⇒ 0 dòng `Denied`.
      // Bỏ `PermissionGuard` = ĐỎ `route-guard-coverage.e2e-spec` ("@RequirePermission trang trí").
      expect(guards).toEqual([ChatOversightAuditGuard, PermissionGuard]);
    });

    it("`PermissionGuard` DENY → 403 và hỏi ĐÚNG cặp (CHAT-ERR-019)", async () => {
      const permSvc = { can: vi.fn().mockResolvedValue(DENY) };
      const guard = new PermissionGuard(new Reflector(), permSvc as never);
      await expect(guard.canActivate(ctxFor(handlerName))).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(permSvc.can).toHaveBeenCalledWith(
        expect.objectContaining({ ...OVERSIGHT_PAIR, isSensitive: true, userId: USER.id }),
      );
    });

    it("`PermissionGuard` ALLOW → qua guard", async () => {
      const permSvc = { can: vi.fn().mockResolvedValue(ALLOW) };
      const guard = new PermissionGuard(new Reflector(), permSvc as never);
      await expect(guard.canActivate(ctxFor(handlerName))).resolves.toBe(true);
    });
  });

  it("KHÔNG route nào đứng ngoài bảng (route thứ 5 phải khai cặp + hai guard)", () => {
    const declared = new Set(ROUTE_GATES.map((g) => g.handlerName as string));
    const missing = routeMethodNames().filter((n) => !declared.has(n));
    expect(missing, `route chưa khai trong ROUTE_GATES: ${missing.join(", ")}`).toEqual([]);
  });

  it("cặp `view:chat-oversight` nằm trong SENSITIVE_CAPABILITY_ALLOWLIST (KI-058)", () => {
    // `getCapabilities()` LỌC mọi cặp `is_sensitive` khỏi `/auth/me` trừ khi có ở allowlist ⇒ thiếu là
    // CHAT-SCREEN-007/008 **ẩn dù DB có quyền**, im lặng, không lỗi, không log. Lớp lỗi đã lặp 8+ lần
    // (memory `sensitive-capability-allowlist-is-backend`). Cặp đã được thêm ở `S7-CHAT-DB-1`; ca này
    // giữ nó không bị dọn nhầm khi WO khác sửa allowlist.
    expect(__SENSITIVE_CAPABILITY_ALLOWLIST_FOR_TEST.has("view:chat-oversight")).toBe(true);
    expect(SENSITIVE_SCREEN_GATE_PAIRS).toContain("view:chat-oversight");
  });
});

describe("ChatOversightAuditGuard — đường TỪ CHỐI để lại đúng 1 dòng audit (CHAT-ERR-019)", () => {
  let permSvc: { can: ReturnType<typeof vi.fn> };
  let audit: { record: ReturnType<typeof vi.fn> };
  let db: { withTenant: ReturnType<typeof vi.fn> };
  let guard: ChatOversightAuditGuard;
  const originalFlag = process.env["PERMISSION_GUARD_ENABLED"];

  beforeEach(() => {
    permSvc = { can: vi.fn() };
    audit = { record: vi.fn().mockResolvedValue(undefined) };
    // `withTenant(companyId, fn)` — chạy callback với một `tx` giả; đủ vì `AuditService` bị mock.
    db = {
      withTenant: vi.fn(
        async (_companyId: string, fn: (tx: unknown) => Promise<unknown>) => await fn({}),
      ),
    };
    guard = new ChatOversightAuditGuard(
      new Reflector(),
      permSvc as never,
      db as never,
      audit as never,
    );
  });

  afterEach(() => {
    if (originalFlag === undefined) delete process.env["PERMISSION_GUARD_ENABLED"];
    else process.env["PERMISSION_GUARD_ENABLED"] = originalFlag;
    vi.restoreAllMocks();
  });

  it("DENY ⇒ ghi ĐÚNG 1 dòng `Denied` và VẪN trả `true` (403 là việc của PermissionGuard)", async () => {
    permSvc.can.mockResolvedValue(DENY);

    await expect(
      guard.canActivate(ctxFor("getRoom", { params: { id: ROOM_ID }, routePath: "/rooms/:id" })),
    ).resolves.toBe(true);

    expect(audit.record).toHaveBeenCalledTimes(1);
    const entry = audit.record.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(entry).toMatchObject({
      action: CHAT_AUDIT.OVERSIGHT_READ,
      objectType: "chat_room",
      objectId: ROOM_ID,
      moduleCode: CHAT_MODULE_CODE,
      resultStatus: "Denied",
      actorUserId: USER.id,
    });
    // Transaction RIÊNG — ném 403 trong cùng tx sẽ ROLLBACK MẤT chính dòng này (API-13 §5.3 bẫy (a)).
    expect(db.withTenant).toHaveBeenCalledWith(USER.companyId, expect.any(Function));
  });

  it("ALLOW ⇒ KHÔNG ghi dòng nào (đường thành công do service ghi, trong CÙNG tx đọc)", async () => {
    permSvc.can.mockResolvedValue(ALLOW);
    await expect(guard.canActivate(ctxFor("getRoom", { params: { id: ROOM_ID } }))).resolves.toBe(
      true,
    );
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("hỏi ĐÚNG cặp đọc TỪ METADATA của route, không hard-code lần thứ hai", async () => {
    permSvc.can.mockResolvedValue(DENY);
    await guard.canActivate(ctxFor("listAudit"));
    expect(permSvc.can).toHaveBeenCalledWith(
      expect.objectContaining({ ...OVERSIGHT_PAIR, isSensitive: true, companyId: USER.companyId }),
    );
  });

  it("ghi audit HỎNG ⇒ vẫn `true` + KHÔNG ném 503 (PermissionGuard phía sau vẫn quyết)", async () => {
    permSvc.can.mockResolvedValue(DENY);
    audit.record.mockRejectedValue(new Error("audit_logs down"));
    // Đường xấu nhất chỉ mất một dòng audit *từ chối*, KHÔNG mở thêm quyền nào. Ngược hẳn với đường
    // THÀNH CÔNG, nơi mất audit là ROLLBACK (audit là điều kiện để dữ liệu rời server).
    await expect(guard.canActivate(ctxFor("getRoom", { params: { id: ROOM_ID } }))).resolves.toBe(
      true,
    );
  });

  it("`can()` ném (lỗi hạ tầng) ⇒ vẫn `true`, không sập request", async () => {
    permSvc.can.mockRejectedValue(new Error("db down"));
    await expect(guard.canActivate(ctxFor("searchRooms"))).resolves.toBe(true);
  });

  it("kill-switch `PERMISSION_GUARD_ENABLED=false` ⇒ 0 dòng audit (không ghi `Denied` SAI SỰ THẬT)", async () => {
    process.env["PERMISSION_GUARD_ENABLED"] = "false";
    permSvc.can.mockResolvedValue(DENY);
    await expect(guard.canActivate(ctxFor("getRoom", { params: { id: ROOM_ID } }))).resolves.toBe(
      true,
    );
    // `PermissionGuard` fail-OPEN khi cờ tắt ⇒ KHÔNG có gì bị từ chối. Một dòng `Denied` lúc đó nói rằng
    // truy cập đã bị chặn trong khi nó được cho qua — audit nói dối, tệ hơn không ghi.
    expect(audit.record).not.toHaveBeenCalled();
    expect(permSvc.can).not.toHaveBeenCalled();
  });

  it("PAT ngoài phạm vi ⇒ ghi `Denied` (PermissionGuard 403 TRƯỚC khi gọi can())", async () => {
    // `permission.guard.ts:100-115` short-circuit 403 cho PAT out-of-scope. Không mirror vế này thì mọi
    // 403 đến qua PAT KHÔNG để lại dấu vết nào — đúng loại lỗ mà WO này tồn tại để bịt.
    permSvc.can.mockResolvedValue(ALLOW);
    await guard.canActivate(
      ctxFor("searchRooms", { viaApiKey: true, scopeKeys: ["view:chat-room"] }),
    );
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect((audit.record.mock.calls[0]?.[1] as Record<string, unknown>)["resultStatus"]).toBe(
      "Denied",
    );
  });

  it("PAT TRONG phạm vi + can() ALLOW ⇒ 0 dòng audit (đối chứng dương của ca trên)", async () => {
    permSvc.can.mockResolvedValue(ALLOW);
    await guard.canActivate(
      ctxFor("searchRooms", { viaApiKey: true, scopeKeys: ["view:chat-oversight"] }),
    );
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("`:id` không phải UUID ⇒ vẫn ghi `Denied`, `objectId` bỏ trống (không nổ 22P02)", async () => {
    // `ParseUUIDPipe` chạy SAU guard, nên chuỗi rác do client gửi tới được đây. INSERT `object_id` bằng
    // rác sẽ nổ `22P02` ⇒ MẤT dòng audit từ chối chỉ vì một tham số bậy.
    permSvc.can.mockResolvedValue(DENY);
    await guard.canActivate(ctxFor("getRoom", { params: { id: "not-a-uuid" } }));
    expect(audit.record).toHaveBeenCalledTimes(1);
    const entry = audit.record.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(entry["objectId"]).toBeUndefined();
    expect(entry["resultStatus"]).toBe("Denied");
  });

  it("không có ngữ cảnh user ⇒ `true`, 0 dòng audit (không mở nổi withTenant)", async () => {
    permSvc.can.mockResolvedValue(DENY);
    await expect(guard.canActivate(ctxFor("searchRooms", { noUser: true }))).resolves.toBe(true);
    expect(audit.record).not.toHaveBeenCalled();
    expect(db.withTenant).not.toHaveBeenCalled();
  });

  it("nhãn `metadata.endpoint` suy đúng theo khuôn đường dẫn của route", async () => {
    permSvc.can.mockResolvedValue(DENY);
    const cases: Array<[string, string, string]> = [
      ["searchRooms", "/chat/oversight/rooms", "018a"],
      ["getRoom", "/chat/oversight/rooms/:id", "018b"],
      ["listMessages", "/chat/oversight/rooms/:id/messages", "018c"],
      ["listAudit", "/chat/oversight/audit", "019"],
    ];
    for (const [handler, routePath, expected] of cases) {
      audit.record.mockClear();
      await guard.canActivate(ctxFor(handler, { routePath, params: { id: ROOM_ID } }));
      const entry = audit.record.mock.calls[0]?.[1] as { metadata?: { endpoint?: string } };
      expect(entry.metadata?.endpoint, `${routePath} → ${expected}`).toBe(expected);
    }
  });
});
