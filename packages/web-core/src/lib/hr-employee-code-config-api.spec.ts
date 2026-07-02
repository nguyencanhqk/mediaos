/**
 * hr-employee-code-config-api.spec.ts — contract/URL boundary tests (S2-FE-HR-8).
 *
 * Mock `apiFetch` tại ranh giới `./api-client` (cùng pattern hr-audit-api.spec.ts) để kiểm chứng
 * employeeCodeConfigApi gọi ĐÚNG path + method + body cho 3 route (view/update/preview).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { employeeCodeConfigApi } from "./hr-employee-code-config-api";
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

const SAMPLE_CONFIG = {
  id: "cfg-1",
  companyId: "co-1",
  prefix: "NV",
  pattern: null,
  numberLength: 4,
  allowManualOverride: true,
  status: "active",
  createdAt: null,
  updatedAt: null,
};

describe("employeeCodeConfigApi", () => {
  beforeEach(() => {
    vi.mocked(apiClient.apiFetch).mockReset();
  });

  it("getConfig() → GET /hr/employee-code-config (không method/body override)", async () => {
    vi.mocked(apiClient.apiFetch).mockResolvedValue(SAMPLE_CONFIG as never);
    await employeeCodeConfigApi.getConfig();
    const [url, schema, init] = lastCall();
    expect(url).toBe("/hr/employee-code-config");
    expect(schema).toBeDefined();
    expect(init).toBeUndefined();
  });

  it("updateConfig(body) → PATCH /hr/employee-code-config kèm body JSON đúng field", async () => {
    vi.mocked(apiClient.apiFetch).mockResolvedValue(SAMPLE_CONFIG as never);
    await employeeCodeConfigApi.updateConfig({ prefix: "NS", numberLength: 5 });
    const [url, , init] = lastCall();
    expect(url).toBe("/hr/employee-code-config");
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(init?.body ?? "{}")).toEqual({ prefix: "NS", numberLength: 5 });
  });

  it("previewNextCode() → POST /hr/employee-code/preview, KHÔNG mutate (body rỗng)", async () => {
    vi.mocked(apiClient.apiFetch).mockResolvedValue({
      sequenceKey: "employee_code",
      value: 42,
      code: "NV0042",
    } as never);
    await employeeCodeConfigApi.previewNextCode();
    const [url, , init] = lastCall();
    expect(url).toBe("/hr/employee-code/preview");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body ?? "{}")).toEqual({});
  });
});
