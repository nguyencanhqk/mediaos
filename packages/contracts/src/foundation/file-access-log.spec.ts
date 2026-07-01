import { describe, expect, it } from "vitest";
// 🔴 RED-first (CLAUDE §6): import từ ./index khi file-access-log.ts CHƯA re-export → ĐỎ đúng lý do.
import {
  FILE_ACCESS_ACTIONS,
  fileAccessLogViewSchema,
  listFileAccessLogsQuerySchema,
} from "./index";

/**
 * S2-FND-BE-3 (L2) — file-access-log contract test. Kiểm: view WHITELIST an toàn (TUYỆT ĐỐI KHÔNG
 * ip_address/user_agent/metadata/storage_path/signed_url), list query z.coerce page/limit + filter.
 */
describe("S2-FND-BE-3 file-access-log contracts", () => {
  describe("fileAccessLogViewSchema (WHITELIST — no-secret-leak)", () => {
    const safeRow = {
      id: "11111111-1111-1111-1111-111111111111",
      fileId: "22222222-2222-2222-2222-222222222222",
      action: "Download" as const,
      accessGranted: true,
      deniedReason: null,
      actorUserId: "33333333-3333-3333-3333-333333333333",
      moduleCode: "HR",
      entityType: "employee_profiles",
      entityId: "44444444-4444-4444-4444-444444444444",
      permissionCode: "hr.employee.view",
      requestId: "req-abc-123",
      createdAt: "2026-07-01T00:00:00.000Z",
    };

    it("parse row an toàn giữ đúng field whitelist", () => {
      expect(fileAccessLogViewSchema.parse(safeRow)).toEqual(safeRow);
    });

    it("STRIP field nhạy cảm: ip_address/user_agent/metadata/storage_path/signed_url KHÔNG lọt", () => {
      const out = fileAccessLogViewSchema.parse({
        ...safeRow,
        ipAddress: "203.0.113.7",
        ip_address: "203.0.113.7",
        userAgent: "Mozilla/5.0 (secret-fingerprint)",
        user_agent: "Mozilla/5.0 (secret-fingerprint)",
        metadata: { signedUrl: "https://r2/secret?sig=x" },
        storagePath: "r2://bucket/secret/path",
        storage_path: "r2://bucket/secret/path",
        signedUrl: "https://r2/secret?sig=x",
        signed_url: "https://r2/secret?sig=x",
        fileLinkId: "55555555-5555-5555-5555-555555555555",
        actorEmployeeId: "66666666-6666-6666-6666-666666666666",
      }) as Record<string, unknown>;
      for (const forbidden of [
        "ipAddress",
        "ip_address",
        "userAgent",
        "user_agent",
        "metadata",
        "storagePath",
        "storage_path",
        "signedUrl",
        "signed_url",
        "actorEmployeeId",
      ]) {
        expect(out).not.toHaveProperty(forbidden);
      }
      // Sanity: whitelist field vẫn còn.
      expect(out.id).toBe(safeRow.id);
      expect(out.action).toBe(safeRow.action);
    });

    it("REJECT action ngoài enum CHECK", () => {
      expect(() => fileAccessLogViewSchema.parse({ ...safeRow, action: "Exfiltrate" })).toThrow();
    });
  });

  describe("listFileAccessLogsQuerySchema (z.coerce + filter)", () => {
    it("rỗng → default page=1 limit=50", () => {
      const out = listFileAccessLogsQuerySchema.parse({});
      expect(out.page).toBe(1);
      expect(out.limit).toBe(50);
    });

    it("coerce query-string page/limit + clamp limit [1..100]", () => {
      expect(listFileAccessLogsQuerySchema.parse({ page: "3", limit: "20" })).toMatchObject({
        page: 3,
        limit: 20,
      });
      expect(listFileAccessLogsQuerySchema.parse({ limit: "9999" }).limit).toBe(100);
      expect(listFileAccessLogsQuerySchema.parse({ limit: "0" }).limit).toBe(1);
    });

    it("filter fileId/actorUserId/action/from/to parse đúng", () => {
      const out = listFileAccessLogsQuerySchema.parse({
        fileId: "22222222-2222-2222-2222-222222222222",
        actorUserId: "33333333-3333-3333-3333-333333333333",
        action: "Preview",
        from: "2026-01-01T00:00:00.000Z",
        to: "2026-07-01T00:00:00.000Z",
      });
      expect(out.action).toBe("Preview");
      expect(out.from).toBeInstanceOf(Date);
      expect(out.to).toBeInstanceOf(Date);
    });

    it("REJECT fileId không phải uuid + action ngoài enum", () => {
      expect(() => listFileAccessLogsQuerySchema.parse({ fileId: "not-a-uuid" })).toThrow();
      expect(() => listFileAccessLogsQuerySchema.parse({ action: "Nope" })).toThrow();
    });

    it("FILE_ACCESS_ACTIONS khớp CHECK file_access_logs.action (mig 0433)", () => {
      expect(FILE_ACCESS_ACTIONS).toEqual([
        "Upload",
        "Download",
        "Preview",
        "Link",
        "Unlink",
        "Delete",
        "GenerateSignedUrl",
      ]);
    });
  });
});
