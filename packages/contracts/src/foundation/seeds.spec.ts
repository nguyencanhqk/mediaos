import { describe, expect, it } from "vitest";
import { seedBatchStatusViewSchema, seedStatusListResponseSchema } from "./index";

/**
 * S2-FND-BE-2 — seed-run status contract test (QA-04/QA-06). Kiểm: view WHITELIST an toàn (STRIP
 * payload/metadata/executedBy/errorMessage/companyId), checksum trả (KHÔNG secret), status enum khớp CHECK.
 */
describe("S2-FND-BE-2 seed-run status contracts", () => {
  const safeRow = {
    id: "11111111-1111-1111-1111-111111111111",
    seedKey: "master-data",
    seedVersion: "v1",
    environment: "prod",
    status: "Success" as const,
    checksum: "abc123checksum",
    startedAt: "2026-07-01T00:00:00.000Z",
    finishedAt: "2026-07-01T00:01:00.000Z",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:01:00.000Z",
  };

  it("parse giữ đúng field whitelist (status/checksum/last-run)", () => {
    const parsed = seedBatchStatusViewSchema.parse(safeRow);
    expect(parsed.status).toBe("Success");
    expect(parsed.checksum).toBe("abc123checksum");
    expect(parsed.finishedAt).toBe("2026-07-01T00:01:00.000Z");
  });

  it("STRIP payload/metadata/executedBy/errorMessage/companyId (KHÔNG secret/PII leak — QA-06)", () => {
    const parsed = seedBatchStatusViewSchema.parse({
      ...safeRow,
      payload: { secret: "sk-xxx", storage_path: "r2://bucket/secret" },
      metadata: { token: "abc" },
      executedBy: "user-1",
      errorMessage: "stack trace with secret",
      companyId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
    });
    expect(parsed).not.toHaveProperty("payload");
    expect(parsed).not.toHaveProperty("metadata");
    expect(parsed).not.toHaveProperty("executedBy");
    expect(parsed).not.toHaveProperty("errorMessage");
    expect(parsed).not.toHaveProperty("companyId");
    expect(JSON.stringify(parsed)).not.toMatch(/storage_path|secret|token|sk-xxx/i);
  });

  it("reject status ngoài enum CHECK", () => {
    expect(() => seedBatchStatusViewSchema.parse({ ...safeRow, status: "Bogus" })).toThrow();
  });

  it("list response = mảng batch status", () => {
    const parsed = seedStatusListResponseSchema.parse([safeRow, safeRow]);
    expect(parsed).toHaveLength(2);
  });
});
