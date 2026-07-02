import { describe, expect, it } from "vitest";
// 🔴 RED-first (CLAUDE §6): import từ ./index khi admin schema CHƯA export → ĐỎ đúng lý do
//    (export thiếu) trước khi implement adminModule* trong module-catalog.ts.
import {
  adminModuleDetailResponseSchema,
  adminModuleDetailSchema,
  adminModuleItemSchema,
  adminModulesResponseSchema,
  myAppItemSchema,
} from "./index";

/**
 * S2-FND-BE-1 (L1) — admin module-catalog contract test (QA-04).
 * Kiểm: adminModuleItemSchema/adminModuleDetailSchema validate response admin list + detail;
 * PHÂN BIỆT rõ với myAppItemSchema (my-apps đã lọc theo user: có is_favorite/is_recent/badges/allowed_actions).
 * Admin thấy HẾT module (active + inactive) kèm cờ enabled resolve theo setting.
 */
describe("S2-FND-BE-1 admin module-catalog contracts", () => {
  const validAdminItem = {
    module_code: "HR",
    name: "Nhân sự",
    description: "Quản lý nhân sự",
    group: "core",
    route: "/hr",
    icon: "users",
    is_active: true,
    enabled: true,
    required_permissions: ["HR.EMPLOYEE.VIEW"],
  };

  const inactiveAdminItem = {
    ...validAdminItem,
    module_code: "PAYROLL",
    name: "Lương",
    description: null,
    group: null,
    route: "/payroll",
    icon: "wallet",
    is_active: false,
    enabled: false,
    required_permissions: [],
  };

  describe("adminModuleItemSchema", () => {
    it("parse row admin hợp lệ giữ đúng field", () => {
      const out = adminModuleItemSchema.parse(validAdminItem);
      expect(out).toEqual(validAdminItem);
    });

    it("chấp nhận module INACTIVE (khác my-apps — admin thấy hết)", () => {
      const out = adminModuleItemSchema.parse(inactiveAdminItem);
      expect(out.is_active).toBe(false);
      expect(out.enabled).toBe(false);
    });

    it("description/group nullable", () => {
      const out = adminModuleItemSchema.parse({
        ...validAdminItem,
        description: null,
        group: null,
      });
      expect(out.description).toBeNull();
      expect(out.group).toBeNull();
    });

    it("REJECT thiếu cờ enabled (bắt buộc cho admin view)", () => {
      const { enabled: _enabled, ...noEnabled } = validAdminItem;
      expect(() => adminModuleItemSchema.parse(noEnabled)).toThrow();
    });
  });

  describe("PHÂN BIỆT admin vs my-apps", () => {
    it("adminModuleItemSchema KHÔNG có field per-user của my-apps (is_favorite/is_recent/badges/allowed_actions)", () => {
      const out = adminModuleItemSchema.parse(validAdminItem) as Record<string, unknown>;
      expect(out).not.toHaveProperty("is_favorite");
      expect(out).not.toHaveProperty("is_recent");
      expect(out).not.toHaveProperty("badges");
      expect(out).not.toHaveProperty("allowed_actions");
    });

    it("myAppItem KHÔNG có cờ enabled (my-apps đã lọc, không phơi enabled riêng)", () => {
      const myApp = {
        module_code: "HR",
        name: "Nhân sự",
        description: null,
        route: "/hr",
        icon: "users",
        group: "core",
        is_active: true,
        is_favorite: false,
        is_recent: false,
        badges: [],
        required_permissions: ["HR.EMPLOYEE.VIEW"],
        allowed_actions: ["read"],
      };
      const out = myAppItemSchema.parse(myApp) as Record<string, unknown>;
      expect(out).not.toHaveProperty("enabled");
    });
  });

  describe("adminModuleDetailSchema + response", () => {
    it("detail validate row admin", () => {
      const out = adminModuleDetailSchema.parse(validAdminItem);
      expect(out.module_code).toBe("HR");
    });

    it("list response = mảng adminModuleItem", () => {
      const out = adminModulesResponseSchema.parse([validAdminItem, inactiveAdminItem]);
      expect(out).toHaveLength(2);
    });

    it("detail response = adminModuleDetail", () => {
      const out = adminModuleDetailResponseSchema.parse(validAdminItem);
      expect(out.enabled).toBe(true);
    });
  });
});
