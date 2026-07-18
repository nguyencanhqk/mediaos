/**
 * hr-audit-api — contract/URL boundary tests (S2-FE-HR-6).
 *
 * KHÔNG mock hrAuditApi; chỉ mock apiFetch tại ranh giới `./api-client` (cùng pattern
 * foundation-api.spec.ts) để kiểm chứng listHrAuditLogs() gọi ĐÚNG path GET /foundation/audit-logs
 * với moduleCode=HR LUÔN gắn kèm (kể cả khi caller không truyền), + truyền validator ĐÚNG HÌNH DẠNG
 * (arg 2). Endpoint TÁI DÙNG — KHÔNG dựng route mới.
 *
 * ⚠️ Mock PHẢI trả MẢNG TRẦN: `apiFetch`/`unwrapEnvelope` chỉ trích `.data` của envelope và bỏ block
 * `pagination`. Mock cũ trả `{data, meta:{total,limit,offset}}` = XANH GIẢ — nó đóng băng đúng giả
 * định sai khiến runtime ném ZodError "Expected object, received array" mà test không hề bắt được.
 * Test "validator CHẤP NHẬN mảng trần / TỪ CHỐI {data,meta}" bên dưới là chốt chặn regression đó.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { hrAuditApi } from "./hr-audit-api";
import * as apiClient from "./api-client";

vi.mock("./api-client", async (importOriginal) => {
  const mod = await importOriginal<typeof apiClient>();
  return { ...mod, apiFetch: vi.fn() };
});

function lastCall(): [string, unknown, { method?: string; body?: string }?] {
  const calls = vi.mocked(apiClient.apiFetch).mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1] as never;
}

describe("hrAuditApi.listHrAuditLogs (URL + moduleCode=HR pin + Zod validator)", () => {
  beforeEach(() => {
    vi.mocked(apiClient.apiFetch).mockReset();
    // Mảng trần — hình dạng THẬT sau unwrapEnvelope (KHÔNG phải {data, meta}).
    vi.mocked(apiClient.apiFetch).mockResolvedValue([] as never);
  });

  it("listHrAuditLogs() không tham số → GET /foundation/audit-logs?moduleCode=HR", async () => {
    await hrAuditApi.listHrAuditLogs();
    const [url, schema] = lastCall();
    expect(url).toBe("/foundation/audit-logs?moduleCode=HR");
    expect(schema).toBeDefined();
  });

  it("listHrAuditLogs({action, limit, offset}) → gắn query + moduleCode=HR CỐ ĐỊNH", async () => {
    await hrAuditApi.listHrAuditLogs({ action: "update", limit: 10, offset: 20 });
    const [url] = lastCall();
    expect(url).toContain("action=update");
    expect(url).toContain("limit=10");
    expect(url).toContain("offset=20");
    expect(url).toContain("moduleCode=HR");
  });

  // ── REGRESSION GUARD (2026-07-18) ──────────────────────────────────────────────────────────────
  // Bug thật: client truyền auditLogListResponseSchema ({data, meta}) trong khi apiFetch đưa vào MẢNG
  // TRẦN ⇒ ZodError dù HTTP 200 ⇒ /hr/audit-logs luôn "Không thể tải lịch sử". Test này khẳng định
  // validator khớp hình dạng THẬT, nên nó đỏ ngay nếu ai đó đổi ngược về schema {data, meta}.
  it("validator (arg 2) CHẤP NHẬN mảng trần và TỪ CHỐI hình {data, meta}", async () => {
    await hrAuditApi.listHrAuditLogs();
    const [, schema] = lastCall();
    const validator = schema as z.ZodType<unknown>;

    // Hình dạng THẬT sau unwrapEnvelope: mảng (rỗng là hợp lệ).
    expect(validator.safeParse([]).success).toBe(true);

    // Hình dạng CŨ (trước PR #16) phải bị từ chối — nếu nó lọt, validator đã sai lại như cũ.
    expect(
      validator.safeParse({ data: [], meta: { total: 0, limit: 25, offset: 0 } }).success,
    ).toBe(false);
  });

  it("caller KHÔNG thể ghi đè moduleCode — wrapper luôn set SAU cùng (dù ép kiểu truyền field lạ)", async () => {
    // @ts-expect-error — moduleCode bị Omit khỏi type HrAuditLogQuery; test runtime-safety khi ép kiểu.
    await hrAuditApi.listHrAuditLogs({ moduleCode: "ATT" });
    const [url] = lastCall();
    const params = new URLSearchParams(url.split("?")[1]);
    // Đúng 1 giá trị moduleCode, luôn = HR (spread {...query, moduleCode: HR} ghi đè bất kỳ input nào).
    expect(params.getAll("moduleCode")).toEqual(["HR"]);
  });
});
