import "reflect-metadata";
import { describe, expect, it } from "vitest";
import {
  REQUIRE_PERMISSION,
  type RequirePermissionMeta,
} from "../permission/require-permission.decorator";
import { ModuleRegistryController } from "./module-registry.controller";

/**
 * AC-7 controller metadata — REGRESSION GUARD cho TRAP G12-4 (objectGrantRequired / reveal-class).
 *
 * Route PUT companies/:id/modules/:moduleKey BẮT BUỘC khai `manage:module-toggle` is_sensitive=true NHƯNG
 * KHÔNG `requiresReauth:true`. Lý do (xem comment controller + module-registry.deny.int-spec (5)):
 * cặp (isSensitive && requiresReauth) bật "reveal-class" ở PermissionGuard → đòi PER-OBJECT grant trên
 * target company; operator chỉ có grant ROLE-level ⇒ deny VĨNH VIỄN. Step-up do OperatorReauthGuard ép,
 * KHÔNG qua permission-engine reauth. Nếu ai đó lỡ thêm requiresReauth:true, test này ĐỎ ngay (không cần DB).
 */
describe("AC-7 ModuleRegistryController metadata (regression guard)", () => {
  const meta = Reflect.getMetadata(
    REQUIRE_PERMISSION,
    ModuleRegistryController.prototype.setModuleEnabled,
  ) as RequirePermissionMeta | undefined;

  it("toggle route khai đúng manage:module-toggle (is_sensitive)", () => {
    expect(meta).toBeDefined();
    expect(meta?.action).toBe("manage");
    expect(meta?.resourceType).toBe("module-toggle");
    expect(meta?.isSensitive).toBe(true);
  });

  it("toggle route KHÔNG đặt requiresReauth (tránh reveal-class object-grant trap)", () => {
    expect(meta?.requiresReauth).toBeFalsy();
  });
});
