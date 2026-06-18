import "reflect-metadata";
import { describe, it, expect } from "vitest";
import { REQUIRE_PERMISSION, type RequirePermissionMeta } from "../permission/require-permission.decorator";
import { UsageController } from "./usage.controller";

/**
 * CS-7 UsageController metadata — regression guard.
 *
 * BẤT BIẾN:
 *  - GET /tenant/usage khai RequirePermission('view', 'usage').
 *  - is_sensitive PHẢI false (không phải reveal-class, không cần step-up).
 *  - requiresReauth PHẢI false/undefined (tránh object-grant trap như AC-7 gotcha).
 *  - Không @OperatorOnly (đây là tenant-self endpoint).
 *
 * Test này không cần DB — kiểm tra metadata chỉ qua reflect.
 */

function metaOf(handler: unknown): RequirePermissionMeta | undefined {
  return Reflect.getMetadata(REQUIRE_PERMISSION, handler as object) as RequirePermissionMeta | undefined;
}

describe("UsageController metadata (CS-7 regression guard)", () => {
  const proto = UsageController.prototype;

  it("getTenantUsage khai RequirePermission('view', 'usage')", () => {
    const m = metaOf(proto.getTenantUsage);
    expect(m?.action).toBe("view");
    expect(m?.resourceType).toBe("usage");
  });

  it("getTenantUsage KHÔNG đặt isSensitive=true (view:usage là non-sensitive, mig 0370)", () => {
    const m = metaOf(proto.getTenantUsage);
    // isSensitive=false hoặc undefined (không set) — KHÔNG phải sensitive
    expect(m?.isSensitive).toBeFalsy();
  });

  it("getTenantUsage KHÔNG đặt requiresReauth (tránh reveal-class object-grant trap)", () => {
    const m = metaOf(proto.getTenantUsage);
    expect(m?.requiresReauth).toBeFalsy();
  });
});
