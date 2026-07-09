/**
 * foundation-api — contract/URL boundary tests (S2-FE-FND-1 · lane FND1-WC).
 *
 * KHÔNG mock foundationApi; chỉ mock apiFetch tại ranh giới `./api-client` (đúng pattern
 * leave-api.spec.ts / attendance-api.spec.ts) để kiểm chứng mỗi method gọi ĐÚNG path+method
 * của controller Foundation + truyền schema Zod làm validator (arg 2).
 *
 * BẤT BIẾN kiểm ở đây:
 *  - FE KHÔNG tự forward company_id (server resolve từ AuthContext) — assert body/query sạch.
 *  - PATCH company/current + company-settings/:key body KHÔNG chứa company_id.
 *  - Cổng quyền/scope + masking là việc SERVER — client chỉ chọn endpoint + validate response.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { companyViewSchema } from "@mediaos/contracts";
import {
  foundationApi,
  holidayApi,
  holidayViewSchema,
  safeSettingViewSchema,
  safeSettingViewListSchema,
  settingsResolveResponseSchema,
  retentionApi,
  fileAccessLogApi,
} from "./foundation-api";
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

describe("foundationApi — company/current (URL + method + Zod validator)", () => {
  beforeEach(() => {
    vi.mocked(apiClient.apiFetch).mockReset();
    vi.mocked(apiClient.apiFetch).mockResolvedValue({} as never);
  });

  it("getCompany → GET /foundation/company/current + companyViewSchema validator", async () => {
    await foundationApi.getCompany();
    const [url, schema, opts] = lastCall();
    expect(url).toBe("/foundation/company/current");
    expect(schema).toBe(companyViewSchema);
    expect(opts?.method ?? "GET").toBe("GET");
  });

  it("updateCompany → PATCH /foundation/company/current + companyViewSchema", async () => {
    await foundationApi.updateCompany({ name: "Acme Đổi" });
    const [url, schema, opts] = lastCall();
    expect(url).toBe("/foundation/company/current");
    expect(schema).toBe(companyViewSchema);
    expect(opts?.method).toBe("PATCH");
    expect(JSON.parse(opts?.body ?? "{}")).toEqual({ name: "Acme Đổi" });
  });

  it("updateCompany body KHÔNG chứa company_id (server resolve từ AuthContext)", async () => {
    await foundationApi.updateCompany({ name: "X", timezone: "Asia/Ho_Chi_Minh" });
    const [url, , opts] = lastCall();
    const body = opts?.body ?? "";
    expect(body).not.toContain("company_id");
    expect(body).not.toContain("companyId");
    // Path cũng không nhét id công ty.
    expect(url).not.toContain("company_id");
  });
});

describe("foundationApi — settings resolve + company-settings PATCH", () => {
  beforeEach(() => {
    vi.mocked(apiClient.apiFetch).mockReset();
    vi.mocked(apiClient.apiFetch).mockResolvedValue({ values: {} } as never);
  });

  it("resolveSettings → POST /foundation/settings/resolve + resolve schema + body keys", async () => {
    await foundationApi.resolveSettings({ keys: ["general.timezone", "general.currency"] });
    const [url, schema, opts] = lastCall();
    expect(url).toBe("/foundation/settings/resolve");
    expect(schema).toBe(settingsResolveResponseSchema);
    expect(opts?.method).toBe("POST");
    expect(JSON.parse(opts?.body ?? "{}")).toEqual({
      keys: ["general.timezone", "general.currency"],
    });
    expect(opts?.body ?? "").not.toContain("company_id");
  });

  it("updateCompanySetting → PATCH /foundation/company-settings/:key + SafeSettingView", async () => {
    vi.mocked(apiClient.apiFetch).mockResolvedValue({} as never);
    await foundationApi.updateCompanySetting("general.timezone", {
      settingValue: "Asia/Ho_Chi_Minh",
      valueType: "String",
      reason: "cập nhật múi giờ",
    });
    const [url, schema, opts] = lastCall();
    expect(url).toBe("/foundation/company-settings/general.timezone");
    expect(schema).toBe(safeSettingViewSchema);
    expect(opts?.method).toBe("PATCH");
    const parsed = JSON.parse(opts?.body ?? "{}");
    expect(parsed.settingValue).toBe("Asia/Ho_Chi_Minh");
    expect(opts?.body ?? "").not.toContain("company_id");
  });

  it("updateCompanySetting encode :key trong path (an toàn ký tự đặc biệt)", async () => {
    vi.mocked(apiClient.apiFetch).mockResolvedValue({} as never);
    await foundationApi.updateCompanySetting("a b/c", { settingValue: 1, valueType: "Number" });
    const [url] = lastCall();
    expect(url).toBe(`/foundation/company-settings/${encodeURIComponent("a b/c")}`);
  });
});

// ---------------------------------------------------------------------------
// foundationApi — system-settings (S2-FE-FND-8) — GLOBAL, gate system-manage:foundation-setting.
// ---------------------------------------------------------------------------

describe("foundationApi — system-settings GET/PATCH (URL + method + Zod validator + no company_id)", () => {
  beforeEach(() => {
    vi.mocked(apiClient.apiFetch).mockReset();
    vi.mocked(apiClient.apiFetch).mockResolvedValue([] as never);
  });

  it("getSystemSettings() → GET /foundation/system-settings KHÔNG query khi không truyền params", async () => {
    await foundationApi.getSystemSettings();
    const [url, schema, opts] = lastCall();
    expect(url).toBe("/foundation/system-settings");
    expect(schema).toBe(safeSettingViewListSchema);
    expect(opts?.method ?? "GET").toBe("GET");
  });

  it("getSystemSettings({category}) → gắn query string đúng, KHÔNG companyId", async () => {
    await foundationApi.getSystemSettings({ category: "Mail" });
    const [url] = lastCall();
    expect(url).toBe("/foundation/system-settings?category=Mail");
    expect(url).not.toContain("companyId");
  });

  it("getSystemSetting(key) → GET /foundation/system-settings/:key + safeSettingViewSchema", async () => {
    vi.mocked(apiClient.apiFetch).mockResolvedValue({} as never);
    await foundationApi.getSystemSetting("mail.smtp_password");
    const [url, schema, opts] = lastCall();
    expect(url).toBe("/foundation/system-settings/mail.smtp_password");
    expect(schema).toBe(safeSettingViewSchema);
    expect(opts?.method ?? "GET").toBe("GET");
  });

  it("updateSystemSetting(key, body) → PATCH /foundation/system-settings/:key + SafeSettingView", async () => {
    vi.mocked(apiClient.apiFetch).mockResolvedValue({} as never);
    await foundationApi.updateSystemSetting("mail.smtp_password", {
      settingValue: "NEW_SECRET",
      valueType: "SecretRef",
      reason: "xoay secret định kỳ",
    });
    const [url, schema, opts] = lastCall();
    expect(url).toBe("/foundation/system-settings/mail.smtp_password");
    expect(schema).toBe(safeSettingViewSchema);
    expect(opts?.method).toBe("PATCH");
    const parsed = JSON.parse(opts?.body ?? "{}");
    expect(parsed.settingValue).toBe("NEW_SECRET");
    expect(opts?.body ?? "").not.toContain("company_id");
    expect(opts?.body ?? "").not.toContain("companyId");
  });

  it("updateSystemSetting encode :key trong path (an toàn ký tự đặc biệt)", async () => {
    vi.mocked(apiClient.apiFetch).mockResolvedValue({} as never);
    await foundationApi.updateSystemSetting("a b/c", { settingValue: 1, valueType: "Number" });
    const [url] = lastCall();
    expect(url).toBe(`/foundation/system-settings/${encodeURIComponent("a b/c")}`);
  });

  it("safeSettingViewListSchema parse mảng SafeSettingView (masked + public trộn lẫn)", () => {
    const parsed = safeSettingViewListSchema.parse([
      {
        key: "mail.smtp_password",
        value: "***",
        valueType: "SecretRef",
        category: "Mail",
        moduleCode: null,
        scope: "system",
        isSensitive: true,
        masked: true,
      },
      {
        key: "system.default_locale",
        value: "vi-VN",
        valueType: "String",
        category: "General",
        moduleCode: "SYSTEM",
        scope: "system",
        isSensitive: false,
        masked: false,
      },
    ]);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].masked).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// holidayApi — S2-FE-FND-4 (URL + method + Zod validator + company_id KHÔNG forward).
// ---------------------------------------------------------------------------

describe("holidayApi — public-holidays (URL + method + Zod validator)", () => {
  beforeEach(() => {
    vi.mocked(apiClient.apiFetch).mockReset();
    vi.mocked(apiClient.apiFetch).mockResolvedValue([] as never);
  });

  it("list() → GET /foundation/public-holidays KHÔNG query khi không truyền params", async () => {
    await holidayApi.list();
    const [url, , opts] = lastCall();
    expect(url).toBe("/foundation/public-holidays");
    expect(opts?.method ?? "GET").toBe("GET");
  });

  it("list({year, month}) → gắn query string đúng", async () => {
    await holidayApi.list({ year: 2026, month: 9 });
    const [url] = lastCall();
    expect(url).toBe("/foundation/public-holidays?year=2026&month=9");
  });

  it("create() → POST /foundation/public-holidays + holidayViewSchema + body KHÔNG company_id", async () => {
    vi.mocked(apiClient.apiFetch).mockResolvedValue({} as never);
    await holidayApi.create({
      holidayCode: "TET-2026",
      name: "Tết Nguyên Đán",
      holidayDate: "2026-02-17",
    });
    const [url, schema, opts] = lastCall();
    expect(url).toBe("/foundation/public-holidays");
    expect(schema).toBe(holidayViewSchema);
    expect(opts?.method).toBe("POST");
    const body = opts?.body ?? "";
    expect(body).not.toContain("company_id");
    expect(body).not.toContain("companyId");
  });

  it("update(id) → PATCH /foundation/public-holidays/:id", async () => {
    vi.mocked(apiClient.apiFetch).mockResolvedValue({} as never);
    await holidayApi.update("hol-1", { name: "Đổi tên" });
    const [url, schema, opts] = lastCall();
    expect(url).toBe("/foundation/public-holidays/hol-1");
    expect(schema).toBe(holidayViewSchema);
    expect(opts?.method).toBe("PATCH");
    expect(JSON.parse(opts?.body ?? "{}")).toEqual({ name: "Đổi tên" });
  });

  it("remove(id) → DELETE /foundation/public-holidays/:id", async () => {
    vi.mocked(apiClient.apiFetch).mockResolvedValue({ id: "hol-1", deleted: true } as never);
    await holidayApi.remove("hol-1");
    const [url, , opts] = lastCall();
    expect(url).toBe("/foundation/public-holidays/hol-1");
    expect(opts?.method).toBe("DELETE");
  });
});

describe("holidayViewSchema", () => {
  it("parse holiday scope 'global' (companyId null, hệ thống — KHÔNG sửa/xoá được ở FE)", () => {
    const parsed = holidayViewSchema.parse({
      id: "hol-g1",
      scope: "global",
      companyId: null,
      holidayCode: "TET",
      name: "Tết",
      holidayDate: "2026-02-17",
      holidayType: "PublicHoliday",
      countryCode: "VN",
      regionCode: null,
      isRecurring: true,
      affectsAttendance: true,
      affectsLeaveCalculation: true,
      isPaidHoliday: true,
      status: "Active",
      source: "seed",
      description: null,
    });
    expect(parsed.scope).toBe("global");
    expect(parsed.companyId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Zod schemas — masking (QA-06): SafeSettingView KHÔNG có field secret_ref;
// resolve trả giá trị đã mask từ server (client chỉ validate shape đã nhận).
// ---------------------------------------------------------------------------

describe("foundation-api Zod schemas", () => {
  it("safeSettingViewSchema KHÔNG có field secret_ref/secretRef (drop tận gốc ở server)", () => {
    const shape = safeSettingViewSchema.shape;
    expect(Object.keys(shape)).not.toContain("secretRef");
    expect(Object.keys(shape)).not.toContain("secret_ref");
    // Field an toàn có mặt.
    expect(Object.keys(shape)).toEqual(
      expect.arrayContaining(["key", "value", "valueType", "scope", "isSensitive", "masked"]),
    );
  });

  it("safeSettingViewSchema parse hàng đã mask (masked=true, value='***')", () => {
    const parsed = safeSettingViewSchema.parse({
      key: "mail.smtp_password",
      value: "***",
      valueType: "SecretRef",
      category: "Mail",
      moduleCode: null,
      scope: "company",
      isSensitive: true,
      masked: true,
    });
    expect(parsed.masked).toBe(true);
    expect(parsed.value).toBe("***");
  });

  it("settingsResolveResponseSchema chấp nhận cả biến thể {values} lẫn {settings}", () => {
    expect(settingsResolveResponseSchema.parse({ values: { "general.timezone": "UTC" } })).toEqual({
      values: { "general.timezone": "UTC" },
    });
    const asSettings = settingsResolveResponseSchema.parse({
      settings: [
        {
          key: "general.currency",
          value: "VND",
          valueType: "String",
          category: "General",
          moduleCode: null,
          scope: "system",
          isSensitive: false,
          masked: false,
        },
      ],
    });
    expect("settings" in asSettings).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// retentionApi — S2-FE-FND-6 (URL + method + Zod validator + no company_id leak)
// ---------------------------------------------------------------------------

describe("retentionApi (URL + method + Zod validator)", () => {
  beforeEach(() => {
    vi.mocked(apiClient.apiFetch).mockReset();
    vi.mocked(apiClient.apiFetch).mockResolvedValue({} as never);
  });

  it("list → GET /foundation/retention-policies", async () => {
    await retentionApi.list();
    const [url, , opts] = lastCall();
    expect(url).toBe("/foundation/retention-policies");
    expect(opts?.method ?? "GET").toBe("GET");
  });

  it("update → PATCH /foundation/retention-policies/:id + body KHÔNG chứa companyId/id", async () => {
    await retentionApi.update("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", {
      retentionDays: 90,
      isEnabled: true,
    });
    const [url, , opts] = lastCall();
    expect(url).toBe("/foundation/retention-policies/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    expect(opts?.method).toBe("PATCH");
    const body = JSON.parse(opts?.body ?? "{}");
    expect(body).toEqual({ retentionDays: 90, isEnabled: true });
    expect(body).not.toHaveProperty("companyId");
    expect(body).not.toHaveProperty("id");
  });
});

// ---------------------------------------------------------------------------
// fileAccessLogApi — S2-FE-FND-6 (URL + query string, append-only — chỉ có method list)
// ---------------------------------------------------------------------------

describe("fileAccessLogApi (URL + query string; append-only — KHÔNG có mutate method)", () => {
  beforeEach(() => {
    vi.mocked(apiClient.apiFetch).mockReset();
    vi.mocked(apiClient.apiFetch).mockResolvedValue([] as never);
  });

  it("list() không tham số → GET /foundation/file-access-logs (không query string)", async () => {
    await fileAccessLogApi.list();
    const [url] = lastCall();
    expect(url).toBe("/foundation/file-access-logs");
  });

  it("list(params) → gắn query string filter + phân trang, KHÔNG companyId", async () => {
    await fileAccessLogApi.list({ page: 2, limit: 20, action: "Download" });
    const [url] = lastCall();
    expect(url).toContain("/foundation/file-access-logs?");
    expect(url).toContain("page=2");
    expect(url).toContain("limit=20");
    expect(url).toContain("action=Download");
    expect(url).not.toContain("companyId");
  });

  it("append-only — module KHÔNG export create/update/remove", () => {
    expect(Object.keys(fileAccessLogApi)).toEqual(["list"]);
  });
});
