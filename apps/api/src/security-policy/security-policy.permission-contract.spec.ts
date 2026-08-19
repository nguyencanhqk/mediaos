/**
 * S10-QA-SECPOLICY-GATE-1 (KI-065) — HỢP ĐỒNG giữa decorator THẬT của `SecurityPolicyController` và
 * quyết định THẬT của `decideCan`. Không mock cờ, không chép tay metadata.
 *
 * VÌ SAO KHÔNG ĐỦ nếu chỉ có int-spec HTTP: `security-mailconfig-http.int-spec.ts` cần Postgres
 * (`describe.skipIf(!hasLaneDb)`) nên máy không có DB thì nó **SKIP im lặng** — đúng lớp
 * `src-green-is-not-integration-green`. File này chạy trong `pnpm test` mặc định (0 I/O, 0 DB), nên
 * bản vá KI-065 luôn có ít nhất một lưới chạy ở MỌI lượt.
 *
 * ĐỌC METADATA THẬT: `Reflect.getMetadata(REQUIRE_PERMISSION, prototype.<handler>)` CHÍNH là thứ
 * `PermissionGuard` đọc (`reflector.getAllAndOverride([handler, class])`). Sửa decorator ⇒ file này
 * thấy ngay, không phụ thuộc ai nhớ cập nhật một bảng hằng số chép tay.
 */

import "reflect-metadata";
import { describe, expect, it } from "vitest";
import { decideCan } from "../permission/permission.decide";
import type { CanInput, CompanyRoleGrant, ObjectGrant } from "../permission/permission.types";
import {
  REQUIRE_PERMISSION,
  type RequirePermissionMeta,
} from "../permission/require-permission.decorator";
import { SecurityPolicyController } from "./security-policy.controller";

const NOW = new Date("2026-08-19T00:00:00.000Z");

function metaOf(handler: "getPolicy" | "updatePolicy"): RequirePermissionMeta {
  const fn: unknown = SecurityPolicyController.prototype[handler];
  const meta = Reflect.getMetadata(REQUIRE_PERMISSION, fn as object) as
    | RequirePermissionMeta
    | undefined;
  if (!meta) {
    throw new Error(`${handler} KHÔNG có @RequirePermission — PermissionGuard sẽ 403 fail-closed`);
  }
  return meta;
}

/** CanInput dựng TỪ metadata thật — đúng cách `PermissionGuard` gọi `permission.can()`. */
function inputFromMeta(meta: RequirePermissionMeta): CanInput {
  return {
    userId: "user-1",
    companyId: "company-1",
    action: meta.action,
    resourceType: meta.resourceType,
    // Route singleton: guard KHÔNG có `:id` để truyền — đây chính là điều kiện đã giết route ở KI-065.
    resourceId: null,
    isSensitive: meta.isSensitive,
    requiresReauth: meta.requiresReauth,
  };
}

/** Grant company-level ĐÚNG cặp, không wildcard (đúng thứ một role admin thật được cấp). */
function exactAllow(meta: RequirePermissionMeta): CompanyRoleGrant {
  return {
    action: meta.action,
    resourceType: meta.resourceType,
    isSensitive: true,
    effect: "ALLOW",
    expiresAt: null,
  };
}

/** Grant wildcard `*:*` (kiểu super-admin) — KHÔNG được thoả cổng nhạy cảm. */
const WILDCARD_ALLOW: CompanyRoleGrant = {
  action: "*",
  resourceType: "*",
  isSensitive: false,
  effect: "ALLOW",
  expiresAt: null,
};

describe("SecurityPolicyController — hợp đồng quyền (KI-065)", () => {
  it("PATCH khai đúng cặp `configure-security-policy:company` + isSensitive, và KHÔNG khai requiresReauth", () => {
    const meta = metaOf("updatePolicy");
    expect(meta.action).toBe("configure-security-policy");
    expect(meta.resourceType).toBe("company");
    expect(meta.isSensitive).toBe(true);
    expect(
      meta.requiresReauth ?? false,
      [
        "",
        "`requiresReauth: true` đã QUAY LẠI trên PATCH /settings/security-policy — đó chính là KI-065:",
        "`needsObjectGrant = isSensitive && requiresReauth` (permission.decide.ts) mà route này KHÔNG có",
        "`:id` ⇒ resourceId luôn null ⇒ 403 `deny-object-required` cho MỌI actor, IM LẶNG (fail-closed).",
        "Muốn ép xác thực lại: xây step-up THẬT trước (WO S10-AUTH-STEPUP-1) — xem ADR DECISIONS-09.",
        "",
      ].join("\n"),
    ).toBe(false);
  });

  it("GET giữ nguyên hợp đồng cũ (isSensitive, không reauth) — bản vá KHÔNG được đụng route đọc", () => {
    const meta = metaOf("getPolicy");
    expect(meta).toMatchObject({
      action: "configure-security-policy",
      resourceType: "company",
      isSensitive: true,
    });
    expect(meta.requiresReauth ?? false).toBe(false);
  });

  it("ALLOW: metadata THẬT + grant company-level ĐÚNG cặp ⇒ decideCan cho phép (route gọi được)", () => {
    const meta = metaOf("updatePolicy");
    const d = decideCan([exactAllow(meta)], [], inputFromMeta(meta), NOW);
    expect(d).toMatchObject({ allow: true, reason: "allow", auditRequired: true });
  });

  it("KHÔNG LEO THANG: chỉ có wildcard `*:*` ⇒ vẫn `deny-sensitive` (cổng nhạy cảm còn nguyên)", () => {
    const meta = metaOf("updatePolicy");
    const d = decideCan([WILDCARD_ALLOW], [], inputFromMeta(meta), NOW);
    expect(d).toMatchObject({ allow: false, reason: "deny-sensitive" });
  });

  it("DENY: không grant nào ⇒ `deny-sensitive`, KHÔNG phải `deny-object-required` (route không chết)", () => {
    const meta = metaOf("updatePolicy");
    const d = decideCan([], [], inputFromMeta(meta), NOW);
    expect(d.allow).toBe(false);
    expect(d.reason).toBe("deny-sensitive");
    expect(d.reason).not.toBe("deny-object-required");
  });
});

/**
 * HỒI QUY CHỐNG LEO THANG — bản vá KI-065 KHÔNG được nới `needsObjectGrant` cho lớp reveal-secret.
 * Ở đây đo ngữ nghĩa engine (`decideCan`) còn nguyên; bằng chứng tầng DB/service nằm ở
 * `test/integration/module-registry.deny.int-spec.ts:137` + `platform-entitlements.deny.int-spec.ts:116`.
 */
describe("permission engine — lớp reveal-secret KHÔNG bị nới bởi bản vá KI-065", () => {
  const REVEAL_INPUT: CanInput = {
    userId: "user-1",
    companyId: "company-1",
    action: "reveal-secret",
    resourceType: "platform-account",
    resourceId: "account-1",
    isSensitive: true,
    requiresReauth: true,
  };
  const COMPANY_ALLOW: CompanyRoleGrant = {
    action: "reveal-secret",
    resourceType: "platform-account",
    isSensitive: true,
    effect: "ALLOW",
    expiresAt: null,
  };
  const OBJECT_ALLOW: ObjectGrant = {
    action: "reveal-secret",
    resourceType: "platform-account",
    isSensitive: true,
    effect: "ALLOW",
  };

  it("route CÓ `:id` + chỉ ALLOW company-level ⇒ vẫn `deny-object-required` (object grant vẫn bắt buộc)", () => {
    const d = decideCan([COMPANY_ALLOW], [], REVEAL_INPUT, NOW);
    expect(d).toMatchObject({ allow: false, reason: "deny-object-required" });
  });

  it("có object ALLOW nhưng cửa sổ re-auth hết hạn ⇒ `deny-reauth-required`", () => {
    const d = decideCan(
      [COMPANY_ALLOW],
      [OBJECT_ALLOW],
      { ...REVEAL_INPUT, ctx: { reauthValidUntil: new Date(NOW.getTime() - 1_000) } },
      NOW,
    );
    expect(d).toMatchObject({
      allow: false,
      reason: "deny-reauth-required",
      requiresReauth: true,
    });
  });

  it("có object ALLOW + cửa sổ re-auth còn hạn ⇒ allow (đường sống của lớp reveal vẫn nguyên)", () => {
    const d = decideCan(
      [COMPANY_ALLOW],
      [OBJECT_ALLOW],
      { ...REVEAL_INPUT, ctx: { reauthValidUntil: new Date(NOW.getTime() + 60_000) } },
      NOW,
    );
    expect(d).toMatchObject({ allow: true, reason: "allow" });
  });
});
