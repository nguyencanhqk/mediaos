/**
 * S5-FND-JOBS-OBS-1 — unit test cho mapper `toSystemJobRunView` (pure fn, KHÔNG cần DB — mẫu
 * `toFileAccessLogView`).
 *
 * Trọng tâm BẤT BIẾN #3 (no-secret-leak): `errorMessage` PHẢI scrub secret (key=value + URL credential) dù
 * hàng DB đã được ghi RAW (mô phỏng dữ liệu cũ trước khi có scrubber ở write-time, hoặc lỗi ghi trực tiếp
 * ngoài JobRunLogger) — phòng thủ chiều sâu tại tầng đọc. `metadata` KHÔNG bao giờ xuất hiện trong view dù
 * row có field lạ (schema `.strip()`).
 */
import { describe, expect, it } from "vitest";
import { toSystemJobRunView } from "./system-jobs.service";
import type { SystemJobRun } from "../../db/schema/system-jobs";

function rawRow(overrides: Partial<SystemJobRun> = {}): SystemJobRun {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    companyId: "22222222-2222-2222-2222-222222222222",
    jobCode: "RETENTION_CLEANUP",
    status: "Success",
    triggeredBy: "Scheduler",
    triggeredByUserId: null,
    startedAt: new Date("2026-07-11T00:00:00.000Z"),
    finishedAt: new Date("2026-07-11T00:00:05.000Z"),
    durationMs: 5000,
    totalItems: 10,
    successItems: 10,
    failedItems: 0,
    errorMessage: null,
    metadata: null,
    createdAt: new Date("2026-07-11T00:00:00.000Z"),
    ...overrides,
  };
}

describe("toSystemJobRunView (WHITELIST masking + error scrub)", () => {
  it("giữ đúng field WHITELIST của DTO view", () => {
    const view = toSystemJobRunView(rawRow());
    expect(view.id).toBe("11111111-1111-1111-1111-111111111111");
    expect(view.jobCode).toBe("RETENTION_CLEANUP");
    expect(view.companyId).toBe("22222222-2222-2222-2222-222222222222");
    expect(view.status).toBe("Success");
    expect(view.triggeredBy).toBe("Scheduler");
    expect(view.durationMs).toBe(5000);
    expect(view.totalItems).toBe(10);
    expect(view.successItems).toBe(10);
    expect(view.failedItems).toBe(0);
  });

  it("chuyển startedAt/finishedAt (Date) → ISO-8601 string trên wire", () => {
    const view = toSystemJobRunView(rawRow());
    expect(view.startedAt).toBe("2026-07-11T00:00:00.000Z");
    expect(view.finishedAt).toBe("2026-07-11T00:00:05.000Z");
  });

  it("finishedAt NULL (run đang Running) → giữ null (KHÔNG throw)", () => {
    const view = toSystemJobRunView(
      rawRow({ finishedAt: null, status: "Running", durationMs: null }),
    );
    expect(view.finishedAt).toBeNull();
    expect(view.durationMs).toBeNull();
  });

  it("companyId NULL (job cấp system/global) → giữ null", () => {
    const view = toSystemJobRunView(rawRow({ companyId: null }));
    expect(view.companyId).toBeNull();
  });

  it("scrub key=value secret trong errorMessage (BẤT BIẾN #3, phòng thủ chiều sâu tại tầng đọc)", () => {
    const view = toSystemJobRunView(
      rawRow({ status: "Failed", errorMessage: "connect failed password=abc123 at host" }),
    );
    expect(view.errorMessage).not.toContain("abc123");
    expect(view.errorMessage).toContain("password=***");
  });

  it("scrub credential nhúng trong URL trong errorMessage", () => {
    const view = toSystemJobRunView(
      rawRow({
        status: "Failed",
        errorMessage: "ECONNREFUSED postgres://dbuser:s3cr3tpass@db-host:5432/mediaos",
      }),
    );
    expect(view.errorMessage).not.toContain("s3cr3tpass");
    expect(view.errorMessage).toContain("postgres://dbuser:***@db-host");
  });

  it("errorMessage NULL (run thành công) → giữ null", () => {
    const view = toSystemJobRunView(rawRow());
    expect(view.errorMessage).toBeNull();
  });

  it("LOẠI BỎ metadata (jsonb tự do) dù row raw có field này — WHITELIST tại nguồn", () => {
    const view = toSystemJobRunView(
      rawRow({ metadata: { internalToken: "tok_live_should_never_leak" } }),
    ) as Record<string, unknown>;
    expect(view).not.toHaveProperty("metadata");
    expect(JSON.stringify(view)).not.toMatch(/tok_live_should_never_leak/);
  });
});
