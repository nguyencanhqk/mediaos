import { describe, expect, it } from "vitest";
// 🔴 RED-first (CLAUDE §6): import từ @mediaos/contracts trước khi module-registry.ts re-export ở index
//    → ĐỎ đúng lý do (export thiếu) trước implement.
import {
  moduleEffectiveStateSchema,
  systemModuleSchema,
  tenantModuleStateSchema,
  toggleModuleRequestSchema,
} from "./index";

/**
 * AC-7 module-registry — contract test. Kiểm: systemModuleSchema (metadata catalog),
 * toggleModuleRequest (enabled boolean bắt buộc), moduleEffectiveStateSchema (key+enabled).
 */
describe("AC-7 module-registry contracts", () => {
  const validModule = {
    id: "11111111-1111-1111-1111-111111111111",
    key: "media",
    name: "Quản lý Media",
    description: "Quản lý kênh/video",
    icon: "video",
    route: "/media",
    featureKeys: ["advanced_analytics", "custom_workflows"],
    dependsOn: [],
    displayOrder: 0,
    isActive: true,
    createdAt: "2026-06-17T00:00:00.000Z",
    updatedAt: "2026-06-17T00:00:00.000Z",
  };

  describe("systemModuleSchema", () => {
    it("chấp nhận module hợp lệ (metadata + bundle feature-key)", () => {
      expect(systemModuleSchema.parse(validModule)).toMatchObject({ key: "media" });
    });

    it("chấp nhận description/icon/route NULL", () => {
      const parsed = systemModuleSchema.parse({
        ...validModule,
        description: null,
        icon: null,
        route: null,
      });
      expect(parsed.description).toBeNull();
    });

    it("REJECT khi featureKeys KHÔNG phải array", () => {
      expect(() =>
        systemModuleSchema.parse({ ...validModule, featureKeys: "advanced_analytics" }),
      ).toThrow();
    });

    it("REJECT khi dependsOn KHÔNG phải array", () => {
      expect(() => systemModuleSchema.parse({ ...validModule, dependsOn: "media" })).toThrow();
    });

    it("REJECT khi thiếu key", () => {
      const { key: _key, ...noKey } = validModule;
      expect(() => systemModuleSchema.parse(noKey)).toThrow();
    });
  });

  describe("toggleModuleRequestSchema", () => {
    it("chấp nhận { enabled: true }", () => {
      expect(toggleModuleRequestSchema.parse({ enabled: true })).toEqual({ enabled: true });
    });

    it("REJECT khi thiếu enabled", () => {
      expect(() => toggleModuleRequestSchema.parse({})).toThrow();
    });

    it("REJECT khi enabled không phải boolean", () => {
      expect(() => toggleModuleRequestSchema.parse({ enabled: "yes" })).toThrow();
    });
  });

  describe("moduleEffectiveStateSchema", () => {
    it("chấp nhận { key, enabled }", () => {
      expect(moduleEffectiveStateSchema.parse({ key: "media", enabled: false })).toEqual({
        key: "media",
        enabled: false,
      });
    });

    it("REJECT khi thiếu enabled", () => {
      expect(() => moduleEffectiveStateSchema.parse({ key: "media" })).toThrow();
    });
  });

  describe("tenantModuleStateSchema (catalog + enabled hiệu lực)", () => {
    it("chấp nhận module + enabled", () => {
      const parsed = tenantModuleStateSchema.parse({ ...validModule, enabled: true });
      expect(parsed.enabled).toBe(true);
      expect(parsed.key).toBe("media");
    });
  });
});
