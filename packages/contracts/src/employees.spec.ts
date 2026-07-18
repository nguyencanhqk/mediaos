import { describe, expect, it } from "vitest";

import { createEmployeeProfileSchema, importEmployeeRowSchema } from "./employees";

/**
 * S5-TASK-HRCODE-1 — hrcode-contracts lane. Cap write-side `fullName` length so an unbounded
 * `actor_name` can never balloon a dead-letter/notification payload. Boundary tests (accept ≤200,
 * reject >200) for the two write-DTOs still on the legacy `employees.ts` surface:
 *   - createEmployeeProfileSchema (used by apps/api/src/employees/employees.dto.ts — POST /employees,
 *     still wired live in app.module.ts, NOT parked).
 *   - importEmployeeRowSchema (legacy media-era import row — kept capped defense-in-depth even though
 *     the live import path today is hr/employee-import.ts's hrEmployeeImportRowSchema).
 */
describe("createEmployeeProfileSchema.fullName — length cap (S5-TASK-HRCODE-1)", () => {
  const MAX = 200;
  const base = { email: "an.nguyen@congty.vn" };

  it("accepts a fullName exactly at the max (200 chars)", () => {
    const fullName = "A".repeat(MAX);
    const parsed = createEmployeeProfileSchema.parse({ ...base, fullName });
    expect(parsed.fullName).toHaveLength(MAX);
  });

  it("rejects a fullName over the max (201 chars)", () => {
    const fullName = "A".repeat(MAX + 1);
    expect(() => createEmployeeProfileSchema.parse({ ...base, fullName })).toThrow();
  });

  it("still rejects an empty fullName (min(1) unchanged)", () => {
    expect(() => createEmployeeProfileSchema.parse({ ...base, fullName: "" })).toThrow();
  });

  it("fullName stays optional (userId-linked create with no fullName)", () => {
    const parsed = createEmployeeProfileSchema.parse({
      userId: "11111111-1111-1111-1111-111111111111",
    });
    expect(parsed.fullName).toBeUndefined();
  });
});

describe("importEmployeeRowSchema.fullName — length cap (S5-TASK-HRCODE-1)", () => {
  const MAX = 200;
  const base = { email: "import.row@congty.vn" };

  it("accepts a fullName exactly at the max (200 chars)", () => {
    const fullName = "B".repeat(MAX);
    const parsed = importEmployeeRowSchema.parse({ ...base, fullName });
    expect(parsed.fullName).toHaveLength(MAX);
  });

  it("rejects a fullName over the max (201 chars)", () => {
    const fullName = "B".repeat(MAX + 1);
    expect(() => importEmployeeRowSchema.parse({ ...base, fullName })).toThrow();
  });

  it("still rejects an empty fullName (min(1) unchanged)", () => {
    expect(() => importEmployeeRowSchema.parse({ ...base, fullName: "" })).toThrow();
  });
});
