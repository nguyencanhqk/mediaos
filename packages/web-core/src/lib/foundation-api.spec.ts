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
  safeSettingViewSchema,
  settingsResolveResponseSchema,
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
