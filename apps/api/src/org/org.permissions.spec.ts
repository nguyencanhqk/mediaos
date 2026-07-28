import "reflect-metadata";
/**
 * G5-FIX F2 — Deny-path RED suite for OrgController permission guards.
 *
 * Hiện trạng (RED): org.controller.ts KHÔNG có @UseGuards(PermissionGuard) lẫn @RequirePermission →
 * mọi user đăng nhập tạo/sửa/xoá phòng ban/team + đổi leader (vi phạm ORG-002/003).
 *
 * Suite này khoá hành vi MONG MUỐN (post-F2):
 *   1. Mỗi MUTATION khai báo đúng @RequirePermission(action, resource) + được PermissionGuard bọc.
 *   2. DENY: user thiếu quyền → ForbiddenException (403).
 *   3. ALLOW: user có quyền → qua guard (true).
 *   4. Route ĐỌC CƠ CẤU giữ mở cho mọi user tenant → KHÔNG guard.
 *
 * ⟲ **S6-SEC-ORG-1 (2026-07-27, đóng KI-030) — ba route ĐỌC chuyển từ mở sang GATE.** Bản trước liệt
 * `listTeams` · `listTeamMembers` · `listEmployees` trong `OPEN_READS` và khẳng định chúng "cố ý mở".
 * Khẳng định đó SAI: ba route này trả dữ liệu VỀ NGƯỜI (danh bạ toàn tenant kèm email, thành viên từng
 * team), không phải cơ cấu — nên chính suite này đã **đóng đinh lỗ hổng thành yêu cầu** và là một phần
 * lý do KI-030 sống lâu. Chúng nay nằm ở `GUARDED_READS`, chịu đúng 4 khẳng định như mutation.
 * `OPEN_READS` chỉ còn DANH MỤC thuần: units · units/tree · departments · roles.
 *
 * Test gọi thẳng PermissionGuard với metadata THẬT của controller (Reflector thật) → chứng minh
 * enforcement end-to-end mà không cần boot Nest/DB (đồng bộ style permission.guard.reveal.spec.ts).
 * Vế HTTP đầu-cuối (403/200 thật, có DB): `test/integration/org-directory-permission.int-spec.ts`.
 */
import { ForbiddenException, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OrgController } from "./org.controller";
import { ORG_EMPLOYEE_DIRECTORY } from "./org.permissions";
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

/** Mọi mutation PHẢI guard (handler → quyền mong đợi). */
const GUARDED_MUTATIONS: ReadonlyArray<{
  handlerName: keyof OrgController;
  action: string;
  resourceType: string;
}> = [
  { handlerName: "createOrgUnit", action: "create", resourceType: "org_unit" },
  { handlerName: "updateOrgUnit", action: "update", resourceType: "org_unit" },
  { handlerName: "deleteOrgUnit", action: "delete", resourceType: "org_unit" },
  { handlerName: "createDepartmentLegacy", action: "create", resourceType: "org_unit" },
  { handlerName: "createTeam", action: "create", resourceType: "team" },
  { handlerName: "updateTeam", action: "update", resourceType: "team" },
  { handlerName: "assignTeamLeader", action: "update", resourceType: "team" },
  { handlerName: "deleteTeam", action: "delete", resourceType: "team" },
  { handlerName: "addTeamMember", action: "update", resourceType: "team" },
  { handlerName: "removeTeamMember", action: "update", resourceType: "team" },
];

/**
 * S6-SEC-ORG-1 — route ĐỌC trả dữ liệu VỀ NGƯỜI: phải gate y như mutation.
 * Cặp quyền lấy từ seed CÓ THẬT: `read:user` (0005:205) · `read:team` (0005:200, 0030:28).
 */
const GUARDED_READS: ReadonlyArray<{
  handlerName: keyof OrgController;
  action: string;
  resourceType: string;
}> = [
  // S6-SEC-ORGSCOPE-1: đọc từ hằng số dùng chung, KHÔNG viết literal. `S6-SEC-PERMVERB-1` đổi động từ
  // sang `view:user` ở đúng một chỗ (`org.permissions.ts`) và census này tự đi theo.
  {
    handlerName: "listEmployees",
    action: ORG_EMPLOYEE_DIRECTORY.action,
    resourceType: ORG_EMPLOYEE_DIRECTORY.resourceType,
  },
  { handlerName: "listTeams", action: "read", resourceType: "team" },
  { handlerName: "listTeamMembers", action: "read", resourceType: "team" },
];

/**
 * Read intentionally open cho mọi user tenant (JWT+Company guard toàn cục vẫn ép tenant).
 * CHỈ danh mục cơ cấu — KHÔNG dữ liệu về người. `apps/app` dùng `getOrgTree` ở OrgChartPage +
 * TaskSidebarTree, nên siết bốn route này sẽ gãy UI của mọi nhân viên.
 */
const OPEN_READS: ReadonlyArray<keyof OrgController> = [
  "listOrgUnits",
  "getOrgTree",
  "listDepartmentsLegacy",
  "listRoles",
];

function handlerOf(name: keyof OrgController): (...args: unknown[]) => unknown {
  return OrgController.prototype[name] as (...args: unknown[]) => unknown;
}

function ctxFor(name: keyof OrgController): ExecutionContext {
  const handler = handlerOf(name);
  return {
    switchToHttp: () => ({ getRequest: () => ({ user: USER, params: {} }) }),
    getHandler: () => handler,
    getClass: () => OrgController,
  } as unknown as ExecutionContext;
}

describe("OrgController — permission guard (F2)", () => {
  let permSvc: { can: ReturnType<typeof vi.fn> };
  let guard: PermissionGuard;

  beforeEach(() => {
    permSvc = { can: vi.fn() };
    guard = new PermissionGuard(new Reflector(), permSvc as never);
  });

  // Mutation và read-đã-gate chịu CÙNG bộ khẳng định — một route đọc lộ danh bạ không được hưởng
  // tiêu chuẩn thấp hơn một route ghi chỉ vì nó là GET.
  describe.each([...GUARDED_MUTATIONS, ...GUARDED_READS])(
    "gated $handlerName → $action:$resourceType",
    ({ handlerName, action, resourceType }) => {
      it("declares @RequirePermission with the expected action + resource", () => {
        const meta = Reflect.getMetadata(REQUIRE_PERMISSION, handlerOf(handlerName)) as
          | RequirePermissionMeta
          | undefined;
        expect(meta).toBeDefined();
        expect(meta).toMatchObject({ action, resourceType });
        // Cơ cấu tổ chức KHÔNG nhạy cảm → không bật isSensitive/requiresReauth.
        expect(meta?.isSensitive ?? false).toBe(false);
      });

      it("is wired with PermissionGuard via @UseGuards", () => {
        const guards =
          (Reflect.getMetadata("__guards__", handlerOf(handlerName)) as unknown[]) ?? [];
        expect(guards).toContain(PermissionGuard);
      });

      it("DENY: user without permission → 403 ForbiddenException", async () => {
        permSvc.can.mockResolvedValue(DENY);
        await expect(guard.canActivate(ctxFor(handlerName))).rejects.toBeInstanceOf(
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

      it("ALLOW: user with permission → guard passes", async () => {
        permSvc.can.mockResolvedValue(ALLOW);
        await expect(guard.canActivate(ctxFor(handlerName))).resolves.toBe(true);
      });
    },
  );

  describe.each(OPEN_READS)("read %s stays open", (name) => {
    it("has no @RequirePermission (unguarded read — tenant-scoped by global guards)", () => {
      expect(Reflect.getMetadata(REQUIRE_PERMISSION, handlerOf(name))).toBeUndefined();
    });
  });
});
