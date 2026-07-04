import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditService } from "../../events/audit.service";
import type { DatabaseService, TenantTx } from "../../db/db.service";
import type { SettingService } from "../settings/setting.service";
import type { FileAccessLogService } from "./file-access-log.service";
import {
  TEMP_FILE_CLEANUP_JOB_CODE,
  TempFileCleanupJobHandler,
} from "./temp-file-cleanup.job-handler";
import type { TempFileCleanupRepository } from "./temp-file-cleanup.repository";

/**
 * S2-FND-JOBS-1 (jobs_tempfile · crown audit/file-soft-delete) — TempFileCleanupJobHandler unit (RED-trước).
 *
 * Handler bọc eligibility + system soft-delete thành JobHandler (scheduler contract). Bất biến chốt:
 *  - run({companyId}) TỰ mở withTenant (BẤT BIẾN #1) — KHÔNG nhận tx từ JobRunner.
 *  - Với mỗi file eligible (cùng tx): softDeleteBySystemTx (deleted_by=NULL, upload_status='Deleted' — BẤT
 *    BIẾN #2, KHÔNG hard-delete) + file_access_logs Delete accessGranted=true actorUserId=null + audit.record
 *    objectType='file' action='FileDeleted' actorType='System' actorUserId=null resultStatus='Success'
 *    dataScope='Company'. BỎ QUA FilePolicy.
 *  - TTL Pending đọc qua SettingService.resolveSetting('file.pending_ttl_hours'); malformed → fallback default.
 *  - Race (softDeleteBySystemTx=0) → KHÔNG ghi log/audit cho file đó (idempotent, đếm skipped, KHÔNG failed).
 *
 * Link-safety THẬT (NOT EXISTS file_links active) sống ở SQL ⇒ phủ ở integration (temp-file-cleanup.int-spec.ts).
 */

const COMPANY_A = "11111111-1111-1111-1111-111111111111";
const FAKE_TX = { __tx: true } as unknown as TenantTx;

interface EligibleRow {
  id: string;
  originalName: string;
  mimeType: string;
  isTemporary: boolean;
  uploadStatus: string;
}

function makeFile(over: Partial<EligibleRow> = {}): EligibleRow {
  return {
    id: `f-${Math.random().toString(16).slice(2, 10)}`,
    originalName: "doc.pdf",
    mimeType: "application/pdf",
    isTemporary: true,
    uploadStatus: "Uploaded",
    ...over,
  };
}

interface Harness {
  handler: TempFileCleanupJobHandler;
  findEligibleTx: ReturnType<typeof vi.fn>;
  softDeleteBySystemTx: ReturnType<typeof vi.fn>;
  accessRecord: ReturnType<typeof vi.fn>;
  auditRecord: ReturnType<typeof vi.fn>;
  resolveSetting: ReturnType<typeof vi.fn>;
}

function makeHandler(opts: {
  eligible?: EligibleRow[];
  softDeleteReturns?: (fileId: string) => number;
  ttlValue?: unknown;
}): Harness {
  const eligible = opts.eligible ?? [];
  const findEligibleTx = vi.fn(async () => eligible);
  const softDeleteBySystemTx = vi.fn(async (_companyId: string, fileId: string) =>
    opts.softDeleteReturns ? opts.softDeleteReturns(fileId) : 1,
  );
  const accessRecord = vi.fn(async () => undefined);
  const auditRecord = vi.fn(async () => undefined);
  const resolveSetting = vi.fn(async (_companyId: string, key: string) => ({
    key,
    value: opts.ttlValue ?? 24,
    scope: "default" as const,
    found: true,
  }));

  const db = {
    withTenant: async <T>(_companyId: string, fn: (tx: TenantTx) => Promise<T>): Promise<T> =>
      fn(FAKE_TX),
  } as unknown as DatabaseService;
  const repo = { findEligibleTx, softDeleteBySystemTx } as unknown as TempFileCleanupRepository;
  const accessLog = { record: accessRecord } as unknown as FileAccessLogService;
  const audit = { record: auditRecord } as unknown as AuditService;
  const settings = { resolveSetting } as unknown as SettingService;

  const handler = new TempFileCleanupJobHandler(db, repo, accessLog, audit, settings);
  return {
    handler,
    findEligibleTx,
    softDeleteBySystemTx,
    accessRecord,
    auditRecord,
    resolveSetting,
  };
}

describe("TempFileCleanupJobHandler", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("jobCode = TEMP_FILE_CLEANUP (khoá system_job_locks + system_job_runs.job_code)", () => {
    const { handler } = makeHandler({});
    expect(handler.jobCode).toBe(TEMP_FILE_CLEANUP_JOB_CODE);
    expect(handler.jobCode).toBe("TEMP_FILE_CLEANUP");
  });

  it("KHÔNG có file eligible → total/success/failed = 0, KHÔNG ghi log/audit", async () => {
    const h = makeHandler({ eligible: [] });
    const res = await h.handler.run({ companyId: COMPANY_A });
    expect(res).toMatchObject({ total: 0, success: 0, failed: 0 });
    expect(h.softDeleteBySystemTx).not.toHaveBeenCalled();
    expect(h.accessRecord).not.toHaveBeenCalled();
    expect(h.auditRecord).not.toHaveBeenCalled();
  });

  it("mỗi file eligible → soft-delete BY SYSTEM + file_access_logs Delete + audit System/null (cùng tx)", async () => {
    const f = makeFile({ id: "file-1", isTemporary: true });
    const h = makeHandler({ eligible: [f] });

    const res = await h.handler.run({ companyId: COMPANY_A });

    // soft-delete gọi cho file eligible, cùng tx (BẤT BIẾN #1/#2).
    expect(h.softDeleteBySystemTx).toHaveBeenCalledWith(COMPANY_A, "file-1", FAKE_TX);

    // file_access_logs: action='Delete', accessGranted=true, actorUserId KHÔNG set (=> null, System actor).
    expect(h.accessRecord).toHaveBeenCalledTimes(1);
    const accessArg = h.accessRecord.mock.calls[0][1];
    expect(accessArg).toMatchObject({ fileId: "file-1", action: "Delete", accessGranted: true });
    expect(accessArg.actorUserId ?? null).toBeNull();

    // audit: objectType='file', action='FileDeleted', actorType='System', actorUserId null, Success/Company.
    expect(h.auditRecord).toHaveBeenCalledTimes(1);
    const auditArg = h.auditRecord.mock.calls[0][1];
    expect(auditArg).toMatchObject({
      action: "FileDeleted",
      objectType: "file",
      objectId: "file-1",
      actorType: "System",
      resultStatus: "Success",
      dataScope: "Company",
    });
    expect(auditArg.actorUserId ?? null).toBeNull();

    expect(res).toMatchObject({ total: 1, success: 1, failed: 0 });
  });

  it("race — softDeleteBySystemTx=0 (đã bị xoá) → KHÔNG ghi log/audit; đếm skipped, KHÔNG failed", async () => {
    const raced = makeFile({ id: "raced" });
    const ok = makeFile({ id: "ok" });
    const h = makeHandler({
      eligible: [raced, ok],
      softDeleteReturns: (id) => (id === "raced" ? 0 : 1),
    });

    const res = await h.handler.run({ companyId: COMPANY_A });

    // Chỉ file 'ok' được ghi log/audit (file 'raced' bị bỏ qua, idempotent).
    expect(h.accessRecord).toHaveBeenCalledTimes(1);
    expect(h.auditRecord).toHaveBeenCalledTimes(1);
    expect(h.accessRecord.mock.calls[0][1]).toMatchObject({ fileId: "ok" });

    expect(res.total).toBe(2);
    expect(res.success).toBe(1);
    expect(res.failed).toBe(0); // race KHÔNG phải failure (không ném) — chỉ skip
  });

  it("TTL Pending đọc qua SettingService('file.pending_ttl_hours') → cutoff = now - ttl*3600s", async () => {
    const before = Date.now();
    const h = makeHandler({ eligible: [], ttlValue: 10 });
    await h.handler.run({ companyId: COMPANY_A });
    const after = Date.now();

    expect(h.resolveSetting).toHaveBeenCalledWith(COMPANY_A, "file.pending_ttl_hours");
    // findEligibleTx(companyId, pendingCutoff, now, tx) — cutoff ≈ now - 10h.
    const [companyArg, pendingCutoff, now] = h.findEligibleTx.mock.calls[0];
    expect(companyArg).toBe(COMPANY_A);
    expect(now).toBeInstanceOf(Date);
    const cutoffMs = (pendingCutoff as Date).getTime();
    const tenHoursMs = 10 * 3_600_000;
    expect(cutoffMs).toBeGreaterThanOrEqual(before - tenHoursMs - 1000);
    expect(cutoffMs).toBeLessThanOrEqual(after - tenHoursMs + 1000);
  });

  it("TTL malformed (không phải số dương) → fallback default 24h (KHÔNG NaN/0 gây xoá nhầm)", async () => {
    const before = Date.now();
    const h = makeHandler({ eligible: [], ttlValue: "not-a-number" });
    await h.handler.run({ companyId: COMPANY_A });
    const after = Date.now();

    const [, pendingCutoff] = h.findEligibleTx.mock.calls[0];
    const cutoffMs = (pendingCutoff as Date).getTime();
    const dayMs = 24 * 3_600_000;
    expect(cutoffMs).toBeGreaterThanOrEqual(before - dayMs - 1000);
    expect(cutoffMs).toBeLessThanOrEqual(after - dayMs + 1000);
  });

  it("audit metadata phân biệt lý do temp-expired vs pending-ttl (chẩn đoán, KHÔNG secret)", async () => {
    const temp = makeFile({ id: "t", isTemporary: true, uploadStatus: "Uploaded" });
    const pending = makeFile({ id: "p", isTemporary: false, uploadStatus: "Pending" });
    const h = makeHandler({ eligible: [temp, pending] });

    await h.handler.run({ companyId: COMPANY_A });

    const reasons = h.auditRecord.mock.calls.map(
      (c) => (c[1].metadata as { reason: string }).reason,
    );
    expect(reasons).toContain("temp-expired");
    expect(reasons).toContain("pending-ttl-exceeded");
  });
});
