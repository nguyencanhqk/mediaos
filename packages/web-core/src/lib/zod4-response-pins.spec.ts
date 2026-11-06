/**
 * S19-OPS-ZOD4-1 — C1 (§4.2 + §9.2-5): web-core parse RESPONSE bằng zod ⇒ id/record lệch là màn VỠ dù HTTP 200.
 *
 * Lấy đúng validator mà method truyền cho `apiFetch` (arg 2) rồi parse fixture giống response thật:
 *  - id canonical đang sống trong DB, không chuẩn RFC (`…0001`, `…0010`, `…00a1`, `1111…`) — zod 4 `z.uuid()`
 *    từ chối ⇒ mutant `idSchema → z.uuid()` phải làm đỏ ca này.
 *  - `byStatus` của /assets/summary chỉ chứa trạng thái ĐANG có tài sản — zod 4 `z.record(<enum>)` vét cạn ⇒
 *    map thiếu khoá thành lỗi (bản vá C3: `z.partialRecord`).
 * XANH trên zod 3.25.76.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as apiClient from "./api-client";
import { assetApi } from "./asset-api";
import { hrMasterDataApi } from "./hr-master-data-api";

vi.mock("./api-client", async (importOriginal) => {
  const mod = await importOriginal<typeof apiClient>();
  return { ...mod, apiFetch: vi.fn() };
});

interface Validator {
  parse: (v: unknown) => unknown;
  safeParse: (v: unknown) => { success: boolean };
}

function lastValidator(): Validator {
  const calls = vi.mocked(apiClient.apiFetch).mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1]![1] as unknown as Validator;
}

describe("web-core response — id canonical + record thiếu khoá", () => {
  beforeEach(() => {
    vi.mocked(apiClient.apiFetch).mockReset();
    vi.mocked(apiClient.apiFetch).mockResolvedValue({} as never);
  });

  it("getDepartment: id/companyId/parentId/headUserId canonical parse được", async () => {
    await hrMasterDataApi.getDepartment("x");
    const fixture = {
      id: "00000000-0000-0000-0000-000000000010",
      companyId: "00000000-0000-0000-0000-000000000001",
      parentId: "00000000-0000-0000-0000-0000000000a1",
      headUserId: "11111111-1111-1111-1111-111111111111",
      name: "Phòng Kỹ thuật",
      code: null,
      description: null,
      status: "active",
      createdAt: "2026-11-01T00:00:00.000Z",
      updatedAt: "2026-11-01T00:00:00.000Z",
    };
    const out = lastValidator().parse(fixture) as Record<string, unknown>;
    expect(out.id).toBe(fixture.id);
    expect(out.companyId).toBe(fixture.companyId);
  });

  it("getDepartment: id rác vẫn bị từ chối (ca dương không nới thành chuỗi trơn)", async () => {
    await hrMasterDataApi.getDepartment("x");
    const res = lastValidator().safeParse({
      id: "khong-phai-uuid",
      companyId: "00000000-0000-0000-0000-000000000001",
      parentId: null,
      headUserId: null,
      name: "x",
      code: null,
      description: null,
      status: "active",
      createdAt: "2026-11-01T00:00:00.000Z",
      updatedAt: "2026-11-01T00:00:00.000Z",
    });
    expect(res.success).toBe(false);
  });

  it("assets summary: byStatus chỉ một trạng thái + categoryId canonical parse được", async () => {
    await assetApi.getSummary();
    const fixture = {
      byStatus: { Assigned: 2 },
      byCategory: [
        {
          categoryId: "00000000-0000-0000-0000-000000000011",
          code: "LAP",
          name: "Laptop",
          total: 2,
          assigned: 2,
        },
      ],
      maintenanceDueSoon: 0,
    };
    expect(lastValidator().parse(fixture)).toEqual(fixture);
  });
});
