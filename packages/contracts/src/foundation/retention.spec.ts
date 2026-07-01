import { describe, expect, it } from "vitest";
// 🔴 RED-first (CLAUDE §6): import từ ./index khi retention.ts CHƯA re-export → ĐỎ đúng lý do
//    (export thiếu) trước khi implement.
import { CLEANUP_ACTIONS, patchRetentionPolicySchema, retentionPolicyViewSchema } from "./index";

/**
 * S2-FND-BE-3 (L2) — retention contract test. Kiểm: view WHITELIST (KHÔNG secret: companyId/metadata/
 * createdBy/updatedBy/deletedAt bị loại), patch chỉ field mutable + cleanupAction enum + retentionDays>=0.
 */
describe("S2-FND-BE-3 retention contracts", () => {
  const validRow = {
    id: "11111111-1111-1111-1111-111111111111",
    moduleCode: "FILES",
    entityType: "file_access_logs",
    retentionDays: 365,
    cleanupAction: "Delete" as const,
    archiveAfterDays: 90,
    deleteAfterDays: 400,
    isLegalHoldSupported: true,
    isEnabled: true,
    description: "purge old access logs",
    updatedAt: "2026-07-01T00:00:00.000Z",
  };

  describe("retentionPolicyViewSchema (WHITELIST, KHÔNG secret)", () => {
    it("parse row hợp lệ giữ đúng field whitelist", () => {
      const out = retentionPolicyViewSchema.parse(validRow);
      expect(out).toEqual(validRow);
    });

    it("STRIP secret/nội bộ: companyId/metadata/createdBy/updatedBy/deletedAt KHÔNG lọt ra", () => {
      const out = retentionPolicyViewSchema.parse({
        ...validRow,
        companyId: "22222222-2222-2222-2222-222222222222",
        metadata: { secretKey: "s3cr3t" },
        createdBy: "33333333-3333-3333-3333-333333333333",
        updatedBy: "44444444-4444-4444-4444-444444444444",
        deletedAt: "2026-07-01T00:00:00.000Z",
      }) as Record<string, unknown>;
      expect(out).not.toHaveProperty("companyId");
      expect(out).not.toHaveProperty("metadata");
      expect(out).not.toHaveProperty("createdBy");
      expect(out).not.toHaveProperty("updatedBy");
      expect(out).not.toHaveProperty("deletedAt");
    });

    it("REJECT cleanupAction ngoài None/Archive/Delete/Anonymize", () => {
      expect(() =>
        retentionPolicyViewSchema.parse({ ...validRow, cleanupAction: "Purge" }),
      ).toThrow();
    });
  });

  describe("patchRetentionPolicySchema (chỉ field mutable)", () => {
    it("CLEANUP_ACTIONS = đúng 4 giá trị khớp CHECK mig 0435", () => {
      expect(CLEANUP_ACTIONS).toEqual(["None", "Archive", "Delete", "Anonymize"]);
    });

    it("accept patch một phần field mutable", () => {
      const out = patchRetentionPolicySchema.parse({ isEnabled: true, cleanupAction: "Archive" });
      expect(out).toEqual({ isEnabled: true, cleanupAction: "Archive" });
    });

    it("REJECT retentionDays < 0", () => {
      expect(() => patchRetentionPolicySchema.parse({ retentionDays: -1 })).toThrow();
    });

    it("REJECT field bất biến (moduleCode/entityType/id/companyId) qua .strict()", () => {
      expect(() => patchRetentionPolicySchema.parse({ moduleCode: "HACK" })).toThrow();
      expect(() => patchRetentionPolicySchema.parse({ entityType: "x" })).toThrow();
      expect(() => patchRetentionPolicySchema.parse({ id: "x" })).toThrow();
      expect(() =>
        patchRetentionPolicySchema.parse({ companyId: "22222222-2222-2222-2222-222222222222" }),
      ).toThrow();
    });

    it("REJECT patch rỗng (không có field để cập nhật → chống audit no-op)", () => {
      expect(() => patchRetentionPolicySchema.parse({})).toThrow();
    });
  });
});
