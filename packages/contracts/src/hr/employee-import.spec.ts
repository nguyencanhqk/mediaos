import { describe, expect, it } from "vitest";

import { createHrEmployeeSchema } from "./employee-write";
import {
  hrEmployeeImportRowSchema,
  hrEmployeeImportQuerySchema,
  hrImportReportSchema,
  hrImportResultSchema,
  hrImportResponseSchema,
  IMPORT_COLUMN_ORDER,
} from "./employee-import";

// Fixture that trips generic-api-key entropy rules is built by concatenation (CLAUDE.md §5) —
// this is a fake password used only to prove .strict() rejects the field, never a real secret.
const FAKE_PASSWORD = ["import", "row", "fake", "pw"].join("-");

/**
 * S5-HR-IMPORT-BE-1 — contracts-import-dto lane (RED-first).
 *
 * NEW schema set for bulk employee import (SPEC-03 §7 / §8 HR.EMPLOYEE.IMPORT). Deliberately NOT the
 * media-era legacy importEmployeeRowSchema (src/employees.ts). Locked design decisions (documented for
 * plan-reviewer): reference fields carry NAMES (server resolves via lookups); NO user/fullName/password
 * (UNLINKED, never-provision); NO baseSalary/PII (salary gated behind update-salary).
 */
describe("hrEmployeeImportRowSchema — bulk import row (UNLINKED / by-name)", () => {
  const validRow = {
    employeeCode: "NV0001",
    email: "an.nguyen@congty.vn",
    orgUnitName: "Phòng Kỹ thuật",
    positionName: "Kỹ sư",
    jobLevelName: "Senior",
    contractTypeName: "Chính thức",
    workType: "remote",
    employmentType: "part_time",
    salaryType: "hourly",
    startDate: "2026-01-15",
    endDate: "2026-12-31",
  };

  it("accepts a fully-specified valid row (reference fields BY NAME)", () => {
    const parsed = hrEmployeeImportRowSchema.parse(validRow);
    expect(parsed.orgUnitName).toBe("Phòng Kỹ thuật");
    expect(parsed.positionName).toBe("Kỹ sư");
    expect(parsed.jobLevelName).toBe("Senior");
    expect(parsed.contractTypeName).toBe("Chính thức");
  });

  it("applies the same enum DEFAULTS as create when structural cells are blank", () => {
    const parsed = hrEmployeeImportRowSchema.parse({});
    expect(parsed.workType).toBe("offline");
    expect(parsed.employmentType).toBe("full_time");
    expect(parsed.salaryType).toBe("monthly");
    expect(parsed.employeeCode).toBeUndefined();
    expect(parsed.email).toBeUndefined();
  });

  it("email is DUP-CHECK only but still must be a valid address when present", () => {
    expect(() => hrEmployeeImportRowSchema.parse({ email: "not-an-email" })).toThrow();
    expect(hrEmployeeImportRowSchema.parse({ email: "x@y.vn" }).email).toBe("x@y.vn");
  });

  it("REJECTS never-provision fields (userId/password/fullName) — .strict() blocks account smuggling", () => {
    expect(() => hrEmployeeImportRowSchema.parse({ userId: crypto.randomUUID() })).toThrow();
    expect(() => hrEmployeeImportRowSchema.parse({ password: FAKE_PASSWORD })).toThrow();
    expect(() => hrEmployeeImportRowSchema.parse({ fullName: "Nguyễn Văn An" })).toThrow();
  });

  it("REJECTS salary/PII smuggling (baseSalary/identityNumber never in import)", () => {
    expect(() => hrEmployeeImportRowSchema.parse({ baseSalary: 9_000_000 })).toThrow();
    expect(() => hrEmployeeImportRowSchema.parse({ identityNumber: "012345678901" })).toThrow();
  });

  it("REJECTS id-style reference fields (orgUnitId/positionId) — this DTO is by-NAME", () => {
    expect(() => hrEmployeeImportRowSchema.parse({ orgUnitId: crypto.randomUUID() })).toThrow();
    expect(() => hrEmployeeImportRowSchema.parse({ positionId: crypto.randomUUID() })).toThrow();
  });

  it("REJECTS invalid enum tokens and malformed dates", () => {
    expect(() => hrEmployeeImportRowSchema.parse({ workType: "onsite" })).toThrow();
    expect(() => hrEmployeeImportRowSchema.parse({ employmentType: "contractor" })).toThrow();
    expect(() => hrEmployeeImportRowSchema.parse({ startDate: "15/01/2026" })).toThrow();
  });

  it("enum values stay in lock-step with createHrEmployeeSchema (drift guard)", () => {
    for (const workType of ["offline", "remote", "hybrid"]) {
      expect(hrEmployeeImportRowSchema.parse({ workType }).workType).toBe(workType);
      expect(createHrEmployeeSchema.parse({ email: "z@z.vn", workType }).workType).toBe(workType);
    }
    for (const salaryType of ["monthly", "hourly", "project"]) {
      expect(hrEmployeeImportRowSchema.parse({ salaryType }).salaryType).toBe(salaryType);
      expect(createHrEmployeeSchema.parse({ email: "z@z.vn", salaryType }).salaryType).toBe(
        salaryType,
      );
    }
  });
});

describe("IMPORT_COLUMN_ORDER — single source of truth (parser + template)", () => {
  it("every column key is a real key of the import row schema", () => {
    const rowKeys = new Set(Object.keys(hrEmployeeImportRowSchema.shape));
    for (const col of IMPORT_COLUMN_ORDER) {
      expect(rowKeys.has(col.key)).toBe(true);
    }
  });

  it("has no duplicate columns and carries a non-empty header for each", () => {
    const keys = IMPORT_COLUMN_ORDER.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const col of IMPORT_COLUMN_ORDER) {
      expect(col.header.length).toBeGreaterThan(0);
    }
  });

  it("leads with employeeCode and covers all structural + reference columns", () => {
    const keys = IMPORT_COLUMN_ORDER.map((c) => c.key);
    expect(keys[0]).toBe("employeeCode");
    expect(keys).toEqual(
      expect.arrayContaining([
        "email",
        "orgUnitName",
        "positionName",
        "jobLevelName",
        "contractTypeName",
        "workType",
        "employmentType",
        "salaryType",
        "startDate",
        "endDate",
      ]),
    );
  });
});

describe("hrImportReportSchema / hrImportResultSchema — dry-run preview vs apply", () => {
  it("dry-run report carries per-row {row, errors[]} + {ok, fail} counts + dryRun:true", () => {
    const report = hrImportReportSchema.parse({
      dryRun: true,
      fileName: "employees.xlsx",
      counts: { ok: 2, fail: 1 },
      errors: [{ row: 3, errors: ["orgUnitName không tồn tại"] }],
    });
    expect(report.dryRun).toBe(true);
    expect(report.counts.fail).toBe(1);
    expect(report.errors[0].row).toBe(3);
  });

  it("report REJECTS dryRun:false (that shape is a result, not a preview)", () => {
    expect(() =>
      hrImportReportSchema.parse({
        dryRun: false,
        fileName: "e.csv",
        counts: { ok: 0, fail: 0 },
        errors: [],
      }),
    ).toThrow();
  });

  it("apply result carries created[]/skipped[]/sessionAuditId + dryRun:false", () => {
    const result = hrImportResultSchema.parse({
      dryRun: false,
      fileName: "employees.csv",
      counts: { ok: 1, fail: 1 },
      created: [{ row: 1, employeeId: crypto.randomUUID(), employeeCode: "NV0007" }],
      skipped: [{ row: 2, errors: ["trùng mã nhân viên"] }],
      sessionAuditId: crypto.randomUUID(),
    });
    expect(result.created).toHaveLength(1);
    expect(result.skipped[0].errors[0]).toContain("trùng");
    expect(result.sessionAuditId).toMatch(/[0-9a-f-]{36}/);
  });

  it("result REJECTS a non-uuid sessionAuditId (audit id must be real)", () => {
    expect(() =>
      hrImportResultSchema.parse({
        dryRun: false,
        fileName: "e.csv",
        counts: { ok: 0, fail: 0 },
        created: [],
        skipped: [],
        sessionAuditId: "not-a-uuid",
      }),
    ).toThrow();
  });

  it("hrImportResponseSchema discriminates preview vs apply on dryRun", () => {
    const preview = hrImportResponseSchema.parse({
      dryRun: true,
      fileName: "e.csv",
      counts: { ok: 0, fail: 0 },
      errors: [],
    });
    expect(preview.dryRun).toBe(true);
    const applied = hrImportResponseSchema.parse({
      dryRun: false,
      fileName: "e.csv",
      counts: { ok: 0, fail: 0 },
      created: [],
      skipped: [],
      sessionAuditId: crypto.randomUUID(),
    });
    expect(applied.dryRun).toBe(false);
  });
});

describe("hrEmployeeImportQuerySchema — dryRun flag (idempotent for double-run pipe)", () => {
  it("defaults dryRun to true (preview is the safe default)", () => {
    expect(hrEmployeeImportQuerySchema.parse({}).dryRun).toBe(true);
  });

  it("coerces string flags and is idempotent when re-parsed (ZodValidationPipe runs twice)", () => {
    const once = hrEmployeeImportQuerySchema.parse({ dryRun: "false" });
    expect(once.dryRun).toBe(false);
    // second pass sees the already-coerced boolean — must not throw / flip
    expect(hrEmployeeImportQuerySchema.parse({ dryRun: once.dryRun }).dryRun).toBe(false);
    expect(hrEmployeeImportQuerySchema.parse({ dryRun: "true" }).dryRun).toBe(true);
    expect(hrEmployeeImportQuerySchema.parse({ dryRun: true }).dryRun).toBe(true);
  });
});
