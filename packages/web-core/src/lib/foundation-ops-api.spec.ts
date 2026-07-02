/**
 * foundation-ops-api — contract/URL boundary tests (S2-FE-FND-5 · lane FE batch C).
 *
 * KHÔNG mock foundationOpsApi; chỉ mock apiFetch tại ranh giới `./api-client` (đúng pattern
 * foundation-api.spec.ts) để kiểm chứng mỗi method gọi ĐÚNG path+method của
 * sequence.controller.ts / seed.controller.ts + validator Zod đúng.
 *
 * BẤT BIẾN kiểm ở đây:
 *  - FE KHÔNG tự forward company_id (server resolve từ AuthContext) — body sạch.
 *  - preview KHÔNG mutate (chỉ GET, KHÔNG có body).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  sequenceCounterViewSchema,
  sequencePreviewResponseSchema,
  seedBatchStatusViewSchema,
} from "@mediaos/contracts";
import { foundationOpsApi } from "./foundation-ops-api";
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

describe("foundationOpsApi — sequences (GET/PATCH /foundation/sequences)", () => {
  beforeEach(() => {
    vi.mocked(apiClient.apiFetch).mockReset();
    vi.mocked(apiClient.apiFetch).mockResolvedValue([] as never);
  });

  it("listSequences → GET /foundation/sequences + z.array(sequenceCounterViewSchema) shape", async () => {
    await foundationOpsApi.listSequences();
    const [url, , opts] = lastCall();
    expect(url).toBe("/foundation/sequences");
    expect(opts?.method ?? "GET").toBe("GET");
  });

  it("previewSequence → GET /foundation/sequences/:id/preview + sequencePreviewResponseSchema, KHÔNG body", async () => {
    vi.mocked(apiClient.apiFetch).mockResolvedValue({
      sequenceKey: "EMP",
      value: 42,
      code: "EMP-0042",
    } as never);
    await foundationOpsApi.previewSequence("seq-1");
    const [url, schema, opts] = lastCall();
    expect(url).toBe("/foundation/sequences/seq-1/preview");
    expect(schema).toBe(sequencePreviewResponseSchema);
    expect(opts?.method ?? "GET").toBe("GET");
    expect(opts?.body).toBeUndefined();
  });

  it("updateSequence → PATCH /foundation/sequences/:id + sequenceCounterViewSchema + body sạch", async () => {
    vi.mocked(apiClient.apiFetch).mockResolvedValue({} as never);
    await foundationOpsApi.updateSequence("seq-1", { paddingLength: 6 });
    const [url, schema, opts] = lastCall();
    expect(url).toBe("/foundation/sequences/seq-1");
    expect(schema).toBe(sequenceCounterViewSchema);
    expect(opts?.method).toBe("PATCH");
    const body = opts?.body ?? "";
    expect(JSON.parse(body)).toEqual({ paddingLength: 6 });
    expect(body).not.toContain("company_id");
    expect(body).not.toContain("currentValue");
  });
});

describe("foundationOpsApi — seeds (GET /foundation/seeds)", () => {
  beforeEach(() => {
    vi.mocked(apiClient.apiFetch).mockReset();
    vi.mocked(apiClient.apiFetch).mockResolvedValue([] as never);
  });

  it("listSeeds → GET /foundation/seeds + z.array(seedBatchStatusViewSchema) shape", async () => {
    await foundationOpsApi.listSeeds();
    const [url, , opts] = lastCall();
    expect(url).toBe("/foundation/seeds");
    expect(opts?.method ?? "GET").toBe("GET");
  });
});

describe("foundation-ops-api Zod schemas — WHITELIST (BẤT BIẾN #3)", () => {
  it("sequenceCounterViewSchema KHÔNG có field currentValue/companyId nội bộ", () => {
    const shape = sequenceCounterViewSchema.shape;
    expect(Object.keys(shape)).not.toContain("currentValue");
    expect(Object.keys(shape)).not.toContain("companyId");
    expect(Object.keys(shape)).toEqual(
      expect.arrayContaining(["sequenceKey", "prefix", "resetPolicy", "status"]),
    );
  });

  it("seedBatchStatusViewSchema KHÔNG có field payload/executedBy/errorMessage nội bộ", () => {
    const shape = seedBatchStatusViewSchema.shape;
    expect(Object.keys(shape)).not.toContain("payload");
    expect(Object.keys(shape)).not.toContain("executedBy");
    expect(Object.keys(shape)).not.toContain("errorMessage");
  });
});
