import "reflect-metadata";
import { describe, expect, it } from "vitest";
import {
  REQUIRE_PERMISSION,
  type RequirePermissionMeta,
} from "../permission/require-permission.decorator";
import { PlatformEntitlementsController } from "./platform-entitlements.controller";

/**
 * AC-2 controller metadata — REGRESSION GUARD cho TRAP reveal-class (G12-4 / AC-7 objectGrantRequired).
 *
 * Mọi route (GET feature-flags/usage-limits/entitlements + PUT feature-flags/usage-limits) khai
 * `manage:platform-subscription` is_sensitive=true (REUSE quyền AC-1 set-plan → 0-seed-change).
 *
 * PUT BẮT BUỘC is_sensitive=true NHƯNG TUYỆT ĐỐI KHÔNG `requiresReauth:true`: cặp
 * (isSensitive && requiresReauth) bật "reveal-class" ở PermissionGuard → đòi PER-OBJECT grant trên
 * target company; operator chỉ có grant ROLE-level (platform-admin) ⇒ deny VĨNH VIỄN. Step-up do
 * OperatorReauthGuard ép (method-level), KHÔNG qua permission-engine reauth. Lỡ thêm requiresReauth:true
 * → test này ĐỎ ngay (không cần DB).
 */
describe("AC-2 PlatformEntitlementsController metadata (regression guard)", () => {
  function metaOf(handler: unknown): RequirePermissionMeta | undefined {
    return Reflect.getMetadata(REQUIRE_PERMISSION, handler as object) as
      | RequirePermissionMeta
      | undefined;
  }

  const proto = PlatformEntitlementsController.prototype;
  const handlers: Array<[string, unknown]> = [
    ["getFeatureFlags", proto.getFeatureFlags],
    ["setFeatureFlag", proto.setFeatureFlag],
    ["getUsageLimits", proto.getUsageLimits],
    ["setUsageLimit", proto.setUsageLimit],
    ["getEntitlements", proto.getEntitlements],
  ];

  it.each(handlers)(
    "%s khai đúng manage:platform-subscription (is_sensitive)",
    (_name, handler) => {
      const meta = metaOf(handler);
      expect(meta).toBeDefined();
      expect(meta?.action).toBe("manage");
      expect(meta?.resourceType).toBe("platform-subscription");
      expect(meta?.isSensitive).toBe(true);
    },
  );

  it.each(handlers)(
    "%s KHÔNG đặt requiresReauth (tránh reveal-class object-grant trap)",
    (_name, handler) => {
      expect(metaOf(handler)?.requiresReauth).toBeFalsy();
    },
  );
});
