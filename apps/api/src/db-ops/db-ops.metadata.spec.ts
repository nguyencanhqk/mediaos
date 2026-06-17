import "reflect-metadata";
import { describe, expect, it } from "vitest";
import { OPERATOR_ONLY } from "../auth/operator-only.decorator";
import {
  REQUIRE_PERMISSION,
  type RequirePermissionMeta,
} from "../permission/require-permission.decorator";
import { DbOpsController } from "./db-ops.controller";

/**
 * AC-9 controller metadata — REGRESSION GUARD cho TRAP reveal-class (G12-4 / AC-7 objectGrantRequired).
 *
 * BẤT BIẾN: KHÔNG handler db-ops nào mang requiresReauth:true. Cặp (isSensitive && requiresReauth) bật
 * "reveal-class" ở PermissionGuard → đòi PER-OBJECT grant trên target; operator chỉ có grant ROLE-level
 * (platform-admin) ⇒ deny VĨNH VIỄN (đã phá AC-7). Step-up cross-tenant = OperatorReauthGuard (method-level)
 * + resolveWindow tường minh ở controller. Lỡ thêm requiresReauth:true → test này ĐỎ ngay (không cần DB).
 *
 * + MỌI handler @OperatorOnly + isSensitive:true + đúng action/resource:
 *   browse → ('read','db-browser'); còn lại (migration-status/grants/exports) → ('manage','db-ops').
 */
function metaOf(handler: unknown): RequirePermissionMeta | undefined {
  return Reflect.getMetadata(REQUIRE_PERMISSION, handler as object) as
    | RequirePermissionMeta
    | undefined;
}
function isOperatorOnly(target: unknown): boolean {
  return Reflect.getMetadata(OPERATOR_ONLY, target as object) === true;
}

describe("AC-9 db-ops controller metadata (regression guard)", () => {
  const proto = DbOpsController.prototype;

  const allHandlers: Array<[string, unknown]> = [
    ["getMigrationStatus", proto.getMigrationStatus],
    ["browse", proto.browse],
    ["listGrants", proto.listGrants],
    ["requestGrant", proto.requestGrant],
    ["approveGrant", proto.approveGrant],
    ["revokeGrant", proto.revokeGrant],
    ["listExports", proto.listExports],
    ["createExport", proto.createExport],
    ["getExport", proto.getExport],
  ];

  it.each(allHandlers)(
    "%s KHÔNG đặt requiresReauth (tránh reveal-class object-grant trap)",
    (_n, h) => {
      expect(metaOf(h)?.requiresReauth).toBeFalsy();
    },
  );

  it.each(allHandlers)("%s khai is_sensitive=true", (_n, h) => {
    expect(metaOf(h)?.isSensitive).toBe(true);
  });

  it.each(allHandlers)("%s là @OperatorOnly (method-level)", (_n, h) => {
    expect(isOperatorOnly(h)).toBe(true);
  });

  it("controller class là @OperatorOnly", () => {
    expect(isOperatorOnly(DbOpsController)).toBe(true);
  });

  it("browse khai read:db-browser", () => {
    const m = metaOf(proto.browse);
    expect(m?.action).toBe("read");
    expect(m?.resourceType).toBe("db-browser");
  });

  it.each([
    ["getMigrationStatus", proto.getMigrationStatus],
    ["listGrants", proto.listGrants],
    ["requestGrant", proto.requestGrant],
    ["approveGrant", proto.approveGrant],
    ["revokeGrant", proto.revokeGrant],
    ["listExports", proto.listExports],
    ["createExport", proto.createExport],
    ["getExport", proto.getExport],
  ] as Array<[string, unknown]>)("%s khai manage:db-ops", (_n, h) => {
    const m = metaOf(h);
    expect(m?.action).toBe("manage");
    expect(m?.resourceType).toBe("db-ops");
  });
});
