/**
 * S2-FND-BE-3 (L4-file-access-log-viewer) — unit test cho mapper `toFileAccessLogView`.
 *
 * RED-trước (mapper CHƯA tồn tại → import fail). GREEN sau khi service ra đời.
 *
 * Trọng tâm BẤT BIẾN #2/#3 (WHITELIST an toàn — no-secret-leak): mapper PHẢI loại BỎ mọi cột nhạy cảm/PII
 * (ip_address / user_agent / metadata / storage_path / signed_url) + cột nội bộ (company_id / actor_employee_id
 * / file_link_id) kể cả khi row RAW mang chúng. Chạy KHÔNG cần Postgres (pure fn) ⇒ vòng RED→GREEN thực.
 */

import { describe, expect, it } from "vitest";
import { toFileAccessLogView } from "./file-access-log-read.service";

/** Row RAW mô phỏng drizzle `.select()` trên file_access_logs (camelCase) — CÓ đủ cột nhạy cảm để test strip. */
function rawRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    companyId: "22222222-2222-2222-2222-222222222222",
    fileId: "33333333-3333-3333-3333-333333333333",
    fileLinkId: "44444444-4444-4444-4444-444444444444",
    actorUserId: "55555555-5555-5555-5555-555555555555",
    actorEmployeeId: "66666666-6666-6666-6666-666666666666",
    action: "Download",
    moduleCode: "HR",
    entityType: "employee_profile",
    entityId: "77777777-7777-7777-7777-777777777777",
    permissionCode: "FOUNDATION.FILE.DOWNLOAD",
    accessGranted: true,
    deniedReason: null,
    ipAddress: "203.0.113.7",
    userAgent: "Mozilla/5.0 (secret-fingerprint)",
    requestId: "req-abc-123",
    metadata: { storage_path: "s3://bucket/secret/path", signed_url: "https://x/secret?token=zzz" },
    createdAt: new Date("2026-07-01T08:30:00.000Z"),
    ...overrides,
  };
}

describe("toFileAccessLogView (WHITELIST masking)", () => {
  it("giữ đúng field WHITELIST của DTO view", () => {
    const view = toFileAccessLogView(rawRow());
    expect(view.id).toBe("11111111-1111-1111-1111-111111111111");
    expect(view.fileId).toBe("33333333-3333-3333-3333-333333333333");
    expect(view.action).toBe("Download");
    expect(view.accessGranted).toBe(true);
    expect(view.actorUserId).toBe("55555555-5555-5555-5555-555555555555");
    expect(view.moduleCode).toBe("HR");
    expect(view.entityType).toBe("employee_profile");
    expect(view.permissionCode).toBe("FOUNDATION.FILE.DOWNLOAD");
    expect(view.requestId).toBe("req-abc-123");
  });

  it("chuyển createdAt (Date) → ISO-8601 string trên wire", () => {
    const view = toFileAccessLogView(rawRow());
    expect(view.createdAt).toBe("2026-07-01T08:30:00.000Z");
  });

  it("LOẠI BỎ cột nhạy cảm/PII: ip_address / user_agent / metadata (BẤT BIẾN #2/#3)", () => {
    const view = toFileAccessLogView(rawRow()) as Record<string, unknown>;
    for (const key of ["ipAddress", "ip_address", "userAgent", "user_agent", "metadata"]) {
      expect(view).not.toHaveProperty(key);
    }
    // storage_path / signed_url KHÔNG bao giờ xuất hiện (không phải cột view; metadata bị strip).
    const serialized = JSON.stringify(view);
    expect(serialized).not.toMatch(/storage_path|signed_url|secret-fingerprint|203\.0\.113\.7/);
  });

  it("LOẠI BỎ cột nội bộ: company_id / actor_employee_id / file_link_id", () => {
    const view = toFileAccessLogView(rawRow()) as Record<string, unknown>;
    for (const key of [
      "companyId",
      "company_id",
      "actorEmployeeId",
      "actor_employee_id",
      "fileLinkId",
      "file_link_id",
    ]) {
      expect(view).not.toHaveProperty(key);
    }
  });

  it("giữ deniedReason (không nhạy cảm) khi accessGranted=false", () => {
    const view = toFileAccessLogView(
      rawRow({ accessGranted: false, deniedReason: "PERMISSION_DENIED" }),
    );
    expect(view.accessGranted).toBe(false);
    expect(view.deniedReason).toBe("PERMISSION_DENIED");
  });
});
