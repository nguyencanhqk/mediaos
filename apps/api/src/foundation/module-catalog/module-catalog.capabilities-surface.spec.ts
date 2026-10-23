/**
 * S14-SEC-CAPWILDCARD-1 — mặt `getMyApps` của hợp đồng capabilities tầng công ty (plan §15.9-F5: #13/#24
 * phải khẳng định ở 4 mặt — getCapabilities · getCapabilityScopes · /auth/me · getMyApps; ca #6 ở mặt
 * app-card).
 *
 * `getMyApps` gộp `{...getCapabilities, ...getAllowlistedSensitiveCapabilities}` rồi lọc app qua
 * `hasAnyCapability` (có nhánh fallback `*`). Spec dùng `PermissionService` THẬT trên stub repo — không mock
 * caps — và một bảng metadata thay thế gồm app gác bằng đúng các cặp cần đo (không app thật nào gác bằng
 * cặp break-glass, nên mặt này chỉ quan sát được qua bảng thay thế).
 */
import { describe, expect, it, vi } from "vitest";
import { ModuleCatalogService } from "./module-catalog.service";
import { PermissionService } from "../../permission/permission.service";
import {
  CapabilityStubRepo,
  companyTierCatalog,
  grant,
} from "../../../test/helpers/capability-stub-repo";
import type { CompanyRoleGrantWithScope } from "../../permission/permission.types";

vi.mock("./module-app-metadata", async (importOriginal) => {
  const orig = await importOriginal<typeof import("./module-app-metadata")>();
  const app = (action: string, resourceType: string) => ({
    route: `/x/${action}`,
    icon: "x",
    requiredAny: [{ action, resourceType }],
    feCodes: [],
  });
  return {
    ...orig,
    MODULE_APP_METADATA: {
      REVEAL_BG: app("reveal-break-glass", "break-glass"),
      REVEAL_SECRET: app("reveal-secret", "platform-account"),
      REQUEST_BG: app("request-break-glass", "break-glass"),
      ADJ_OWN: app("view-own", "adjustment"),
      USER_VIEW: app("view", "user"),
    },
  };
});

const ACTOR = {
  id: "11111111-1111-4111-8111-111111111111",
  companyId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
};
const CODES = ["REVEAL_BG", "REVEAL_SECRET", "REQUEST_BG", "ADJ_OWN", "USER_VIEW"];

function moduleRow(moduleCode: string, sortOrder: number) {
  return {
    id: `id-${moduleCode}`,
    moduleCode,
    name: moduleCode,
    description: `desc ${moduleCode}`,
    moduleGroup: "Core",
    version: null,
    isCore: false,
    isMvp: true,
    isActive: true,
    sortOrder,
    dependencies: null,
    metadata: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    deletedBy: null,
  };
}

async function myAppCodes(grants: readonly CompanyRoleGrantWithScope[]): Promise<string[]> {
  const repo = {
    findActiveModules: vi.fn().mockResolvedValue(CODES.map((c, i) => moduleRow(c, i))),
  };
  const settings = {
    resolveMany: vi
      .fn()
      .mockImplementation((_co: string, keys: string[]) =>
        Promise.resolve(
          keys.map((key) => ({ key, value: undefined, scope: "default", found: false })),
        ),
      ),
  };
  const permission = new PermissionService(
    new CapabilityStubRepo().withGrants(grants).withCatalog(companyTierCatalog()),
  );
  const svc = new ModuleCatalogService(repo as never, settings as never, permission);
  return (await svc.getMyApps(ACTOR)).map((a) => a.module_code);
}

describe("S14-SEC-CAPWILDCARD-1 — getMyApps phản chiếu capabilities tầng công ty", () => {
  it("#13/#24/#6 grant exact reveal-* + request-break-glass + view-own:adjustment ⇒ app reveal VẮNG; 2 app kia HIỆN", async () => {
    const codes = await myAppCodes([
      grant("reveal-break-glass", "break-glass", { isSensitive: true }),
      grant("reveal-secret", "platform-account", { isSensitive: true }),
      grant("request-break-glass", "break-glass", { isSensitive: true }),
      grant("view-own", "adjustment", { isSensitive: true }),
    ]);

    expect(codes).toEqual(["REQUEST_BG", "ADJ_OWN"]);
  });

  it("#7 actor CHỈ ('*','*') ⇒ chỉ app gác bằng cặp non-sensitive HIỆN; app reveal / sensitive VẮNG", async () => {
    expect(await myAppCodes([grant("*", "*")])).toEqual(["USER_VIEW"]);
  });
});
