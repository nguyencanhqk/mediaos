import "reflect-metadata";
import { describe, expect, it } from "vitest";
import { OPERATOR_ONLY } from "../auth/operator-only.decorator";
import {
  REQUIRE_PERMISSION,
  type RequirePermissionMeta,
} from "../permission/require-permission.decorator";
import { AuditReadController } from "./audit-read.controller";
import { QueueMonitorController } from "./queue-monitor.controller";

/**
 * AC-8 controller metadata — REGRESSION GUARD cho TRAP reveal-class (G12-4 / AC-7 objectGrantRequired).
 *
 * BẤT BIẾN: KHÔNG route AC-8 nào mang requiresReauth:true. Cặp (isSensitive && requiresReauth) bật
 * "reveal-class" ở PermissionGuard → đòi PER-OBJECT grant trên target; operator chỉ có grant ROLE-level
 * (platform-admin) ⇒ deny VĨNH VIỄN (đã phá AC-7). Step-up cross-tenant = OperatorReauthGuard (method-level)
 * + kiểm window tường minh ở controller. Lỡ thêm requiresReauth:true → test này ĐỎ ngay (không cần DB).
 *
 * + Route cross-tenant PHẢI mang @OperatorOnly (aud=operator) + @RequirePermission(view:platform-audit).
 */
function metaOf(handler: unknown): RequirePermissionMeta | undefined {
  return Reflect.getMetadata(REQUIRE_PERMISSION, handler as object) as
    | RequirePermissionMeta
    | undefined;
}
function isOperatorOnly(target: unknown): boolean {
  return Reflect.getMetadata(OPERATOR_ONLY, target as object) === true;
}

describe("AC-8 observability controller metadata (regression guard)", () => {
  const auditProto = AuditReadController.prototype;
  const queueProto = QueueMonitorController.prototype;

  const allHandlers: Array<[string, unknown]> = [
    ["listTenantAudit", auditProto.listTenantAudit],
    ["listPlatformAudit", auditProto.listPlatformAudit],
    ["getQueueStatus", queueProto.getQueueStatus],
  ];

  it.each(allHandlers)("%s KHÔNG đặt requiresReauth (tránh reveal-class object-grant trap)", (_n, h) => {
    expect(metaOf(h)?.requiresReauth).toBeFalsy();
  });

  it.each(allHandlers)("%s khai is_sensitive=true", (_n, h) => {
    expect(metaOf(h)?.isSensitive).toBe(true);
  });

  it("tenant-self audit khai view:audit-log", () => {
    const m = metaOf(auditProto.listTenantAudit);
    expect(m?.action).toBe("view");
    expect(m?.resourceType).toBe("audit-log");
  });

  it("cross-tenant audit khai view:platform-audit + @OperatorOnly trên handler/class", () => {
    const m = metaOf(auditProto.listPlatformAudit);
    expect(m?.action).toBe("view");
    expect(m?.resourceType).toBe("platform-audit");
    // @OperatorOnly trên method (listPlatformAudit) — controller-level không @OperatorOnly để tenant route chung class.
    expect(isOperatorOnly(auditProto.listPlatformAudit)).toBe(true);
  });

  it("cross-tenant queue khai view:platform-audit + @OperatorOnly (class-level)", () => {
    const m = metaOf(queueProto.getQueueStatus);
    expect(m?.action).toBe("view");
    expect(m?.resourceType).toBe("platform-audit");
    expect(isOperatorOnly(QueueMonitorController)).toBe(true);
  });
});
