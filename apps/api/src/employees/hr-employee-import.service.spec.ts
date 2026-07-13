import { describe, it, expect, vi, beforeEach } from "vitest";
import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { HrEmployeeImportService, type ImportUpload } from "./hr-employee-import.service";

/**
 * S5-HR-IMPORT-BE-1 (RED-first) — unit coverage for the crown-jewel import behaviors that DON'T need
 * Postgres: scope-deny (defense-in-depth 403), MIME/extension 400, dryRun no-write (0 create / 0 audit /
 * 0 sequence), in-file + DB duplicate flagging, apply partial-success + exactly-one session audit, and the
 * UNLINKED/never-provision guarantee (createFromImportTx receives structural ids only — no userId/email).
 * The full guard 403 + cross-tenant deny path is proven in the int-hr-import int-spec under LANE_DB.
 */

const ACTOR = { id: "11111111-1111-1111-1111-111111111111", companyId: "co-a" };
const NEW_ID = "22222222-2222-2222-2222-222222222222";
const AUDIT_ID = "33333333-3333-3333-3333-333333333333";

// Column order mirrors IMPORT_COLUMN_ORDER: code,email,org,position,jobLevel,contractType,workType,
// employmentType,salaryType,startDate,endDate.
const HEADER = ["code", "email", "org", "pos", "lvl", "ct", "wt", "et", "st", "start", "end"];
function dataRow(over: Record<number, string> = {}): string[] {
  const base = [
    "NV0001",
    "an@x.vn",
    "Phòng Kỹ thuật",
    "Kỹ sư",
    "Senior",
    "Chính thức",
    "offline",
    "full_time",
    "monthly",
    "2026-01-15",
    "",
  ];
  for (const [k, v] of Object.entries(over)) base[Number(k)] = v;
  return base;
}

function csvFile(): ImportUpload {
  return {
    originalname: "employees.csv",
    mimetype: "text/csv",
    size: 100,
    buffer: Buffer.from("dummy"),
  };
}

function makeService(matrix: string[][]) {
  const parser = { parse: vi.fn().mockResolvedValue(matrix) };
  const importRepo = {
    findOrgUnitIdByNameTx: vi.fn().mockResolvedValue("org-1"),
    findPositionIdByNameTx: vi.fn().mockResolvedValue("pos-1"),
    findJobLevelIdByNameTx: vi.fn().mockResolvedValue("lvl-1"),
    findContractTypeIdByNameTx: vi.fn().mockResolvedValue("ct-1"),
    employeeCodeInUseTx: vi.fn().mockResolvedValue(false),
    userEmailExistsTx: vi.fn().mockResolvedValue(false),
    insertSessionAuditTx: vi.fn().mockResolvedValue(AUDIT_ID),
  };
  const hrWrite = {
    createFromImportTx: vi.fn().mockResolvedValue({ id: NEW_ID, employeeCode: "NV0001" }),
  };
  const dataScope = { resolveAndAssert: vi.fn().mockResolvedValue("Company") };
  const db = { withTenant: vi.fn((_cid: string, fn: (tx: unknown) => unknown) => fn({})) };

  const svc = new HrEmployeeImportService(
    db as never,
    importRepo as never,
    hrWrite as never,
    parser as never,
    dataScope as never,
  );
  return { svc, parser, importRepo, hrWrite, dataScope, db };
}

describe("HrEmployeeImportService", () => {
  beforeEach(() => vi.clearAllMocks());

  it("DENY (defense-in-depth): a non-Company scope → 403 before any parse/write", async () => {
    const { svc, parser, hrWrite, dataScope } = makeService([HEADER, dataRow()]);
    dataScope.resolveAndAssert.mockResolvedValue("Own");

    await expect(svc.import(ACTOR, csvFile(), true)).rejects.toBeInstanceOf(ForbiddenException);
    expect(parser.parse).not.toHaveBeenCalled();
    expect(hrWrite.createFromImportTx).not.toHaveBeenCalled();
  });

  it("wrong MIME/extension → 400, no parse, no write", async () => {
    const { svc, parser, hrWrite, importRepo } = makeService([HEADER, dataRow()]);
    const bad: ImportUpload = {
      originalname: "bad.json",
      mimetype: "application/json",
      size: 10,
      buffer: Buffer.from("x"),
    };
    await expect(svc.import(ACTOR, bad, false)).rejects.toBeInstanceOf(BadRequestException);
    expect(parser.parse).not.toHaveBeenCalled();
    expect(hrWrite.createFromImportTx).not.toHaveBeenCalled();
    expect(importRepo.insertSessionAuditTx).not.toHaveBeenCalled();
  });

  it("MIME mismatched to a .csv extension → 400 (not 500)", async () => {
    const { svc } = makeService([HEADER, dataRow()]);
    const bad: ImportUpload = {
      originalname: "x.csv",
      mimetype: "application/json",
      size: 10,
      buffer: Buffer.from("x"),
    };
    await expect(svc.import(ACTOR, bad, true)).rejects.toBeInstanceOf(BadRequestException);
  });

  it("dryRun (default) → report, NO create, NO session audit, NO sequence touch", async () => {
    const { svc, hrWrite, importRepo } = makeService([
      HEADER,
      dataRow(),
      dataRow({ 0: "NV0002", 1: "b@x.vn" }),
    ]);

    const res = await svc.import(ACTOR, csvFile(), true);

    expect(res.dryRun).toBe(true);
    expect(res.counts).toEqual({ ok: 2, fail: 0 });
    expect(hrWrite.createFromImportTx).not.toHaveBeenCalled();
    expect(importRepo.insertSessionAuditTx).not.toHaveBeenCalled();
  });

  it("in-file duplicate email → BOTH rows flagged, ok excludes them", async () => {
    const rows = [HEADER, dataRow({ 0: "NV0001" }), dataRow({ 0: "NV0002" })]; // same email an@x.vn
    const { svc } = makeService(rows);

    const res = await svc.import(ACTOR, csvFile(), true);
    if (!res.dryRun) throw new Error("expected dry-run report");
    expect(res.counts).toEqual({ ok: 0, fail: 2 });
    expect(res.errors).toHaveLength(2);
    expect(res.errors[0].errors.join()).toContain("trùng trong file");
  });

  it("DB duplicate employeeCode → row flagged (unique index is the backstop)", async () => {
    const { svc, importRepo } = makeService([HEADER, dataRow()]);
    importRepo.employeeCodeInUseTx.mockResolvedValue(true);

    const res = await svc.import(ACTOR, csvFile(), true);
    if (!res.dryRun) throw new Error("expected dry-run report");
    expect(res.counts).toEqual({ ok: 0, fail: 1 });
    expect(res.errors[0].errors.join()).toContain("đã tồn tại");
  });

  it("unresolved reference name → row flagged", async () => {
    const { svc, importRepo } = makeService([HEADER, dataRow()]);
    importRepo.findOrgUnitIdByNameTx.mockResolvedValue(undefined);

    const res = await svc.import(ACTOR, csvFile(), true);
    if (!res.dryRun) throw new Error("expected dry-run report");
    expect(res.counts).toEqual({ ok: 0, fail: 1 });
    expect(res.errors[0].errors.join()).toContain("không tồn tại");
  });

  it("apply happy-path → N creates (UNLINKED, no userId/email), 1 session audit, counts", async () => {
    const rows = [
      HEADER,
      dataRow({ 0: "NV0001", 1: "a@x.vn" }),
      dataRow({ 0: "NV0002", 1: "b@x.vn" }),
    ];
    const { svc, hrWrite, importRepo } = makeService(rows);

    const res = await svc.import(ACTOR, csvFile(), false);

    expect(res.dryRun).toBe(false);
    expect(res.counts).toEqual({ ok: 2, fail: 0 });
    expect(hrWrite.createFromImportTx).toHaveBeenCalledTimes(2);
    // UNLINKED / never-provision: the create payload carries structural ids only — no userId/email/password.
    const payload = hrWrite.createFromImportTx.mock.calls[0][1] as Record<string, unknown>;
    expect(payload).not.toHaveProperty("userId");
    expect(payload).not.toHaveProperty("email");
    expect(payload).not.toHaveProperty("password");
    expect(payload.orgUnitId).toBe("org-1");
    // exactly ONE session audit, written after the loop with {ok, fail}.
    expect(importRepo.insertSessionAuditTx).toHaveBeenCalledTimes(1);
    expect(importRepo.insertSessionAuditTx.mock.calls[0][1]).toMatchObject({ ok: 2, fail: 0 });
    if (!res.dryRun) expect(res.sessionAuditId).toBe(AUDIT_ID);
  });

  it("apply partial-success → valid row created, failing row skipped (own tx), audit ok/fail", async () => {
    const rows = [
      HEADER,
      dataRow({ 0: "NV0001", 1: "a@x.vn" }),
      dataRow({ 0: "NV0002", 1: "b@x.vn" }),
    ];
    const { svc, hrWrite, importRepo } = makeService(rows);
    hrWrite.createFromImportTx
      .mockResolvedValueOnce({ id: NEW_ID, employeeCode: "NV0001" })
      .mockRejectedValueOnce(new BadRequestException("boom"));

    const res = await svc.import(ACTOR, csvFile(), false);

    expect(res.counts).toEqual({ ok: 1, fail: 1 });
    if (!res.dryRun) {
      expect(res.created).toHaveLength(1);
      expect(res.skipped).toHaveLength(1);
    }
    expect(importRepo.insertSessionAuditTx.mock.calls[0][1]).toMatchObject({ ok: 1, fail: 1 });
  });

  it("empty file (header only) → 400", async () => {
    const { svc } = makeService([HEADER]);
    await expect(svc.import(ACTOR, csvFile(), true)).rejects.toBeInstanceOf(BadRequestException);
  });

  it("template CSV → BOM + header + example columns from IMPORT_COLUMN_ORDER", () => {
    const { svc } = makeService([HEADER]);
    const csv = svc.getTemplateCsv();
    expect(csv.charCodeAt(0)).toBe(0xfeff); // UTF-8 BOM
    expect(csv).toContain("Mã nhân viên");
    expect(csv.split("\r\n").filter(Boolean)).toHaveLength(2); // header + example
  });
});
