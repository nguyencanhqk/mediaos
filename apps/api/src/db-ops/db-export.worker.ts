import { Injectable, Logger } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { DB_EXPORT_MAX_ROWS } from "@mediaos/contracts";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { ObjectStorageService } from "../storage/object-storage.service";
import { buildExportKey } from "../storage/storage-key";
import { OperatorActionAuditService } from "../platform/operator-action-audit.service";
import {
  allowedColumns,
  assertTableAllowed,
  isAllowedColumn,
  type DbBrowserTable,
} from "./db-ops-allowlist";
import { AUDIT_DB_EXPORT } from "./db-ops.constants";
import { DbExportJobRepository, type DbExportJobRow } from "./db-export-job.repository";

const EXPORT_CONTENT_TYPE = "text/csv";
// BẤT BIẾN #3: KHÔNG lưu raw message của lib vào db_export_jobs.error (có thể echo filter VALUE/PII của
// operator — vd lỗi cú pháp uuid chứa giá trị filter). Lưu nhãn GENERIC; chi tiết đầy đủ CHỈ ở server log.
const EXPORT_FAILED_MESSAGE = "Export thất bại — xem server log để biết chi tiết.";

/**
 * DbExportWorker (🔴 WAVE 3 C2 — nối scaffold AC-9 P4; ADR-0020 §4 gỡ DEFER worker). Mirror OutboxWorker:
 * one-shot `processBatch()` (KHÔNG vòng lặp; test gọi trực tiếp, scheduler gọi định kỳ — cùng mô hình invoke
 * như OutboxWorker, chưa wire scheduler prod ở repo này).
 *
 * Mỗi job 'queued' → claim (FOR UPDATE SKIP LOCKED → 'running') → đọc rows TARGET tenant qua
 * withTenant(target) (RLS ÉP, CHỈ cột allowlist — redact secret/PII), serialize CSV, PUT object storage
 * (key tenant-scoped server-derived), finalize 'done' + row_count + object_key + audit — ATOMIC trong 1 tx
 * withTenant(target). Lỗi 1 job ⇒ markFailed + audit, KHÔNG abort cả batch (per-job try/catch, mirror outbox).
 *
 * KHÔNG dùng workerDb/BYPASSRLS: đọc 1 tenant/lần qua app pool (mediaos_app NOBYPASSRLS) — RLS đúng. File
 * ephemeral: download qua presigned GET TTL ngắn ở getJob (KHÔNG persist URL). Cap DB_EXPORT_MAX_ROWS.
 */
@Injectable()
export class DbExportWorker {
  private readonly logger = new Logger(DbExportWorker.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: DbExportJobRepository,
    private readonly storage: ObjectStorageService,
    private readonly operatorAudit: OperatorActionAuditService,
  ) {}

  async processBatch(batchSize = 5): Promise<{ claimed: number; done: number; failed: number }> {
    const claimed = await this.db.withTransaction((tx) =>
      this.repo.claimQueuedJobsTx(tx, batchSize),
    );
    let done = 0;
    let failed = 0;
    for (const job of claimed) {
      const ok = await this.processJob(job);
      if (ok) done += 1;
      else failed += 1;
    }
    return { claimed: claimed.length, done, failed };
  }

  /** Materialize 1 job. Trả true nếu 'done', false nếu 'failed'. KHÔNG ném (cô lập lỗi 1 job). */
  private async processJob(job: DbExportJobRow): Promise<boolean> {
    let uploadedKey: string | null = null;
    try {
      const table = assertTableAllowed(job.tableName);
      const columns = allowedColumns(table);
      const filters = this.parseFilters(table, job.filter);

      // Đọc rows TARGET tenant — withTenant(target) RLS ÉP company_id=current ⇒ CHỈ rows của target.
      const rows = await this.db.withTenant(job.targetTenantId, (tx) =>
        this.readRows(tx, table, columns, filters),
      );

      const csv = toCsv(columns, rows);
      const key = buildExportKey(job.targetTenantId, job.id);
      await this.storage.putObject(key, csv, EXPORT_CONTENT_TYPE);
      uploadedKey = key;

      // Finalize + audit ATOMIC trong 1 tx withTenant(target): markDone (db_export_jobs global) + audit
      // (audit_logs WITH CHECK keyed company_id ⇒ company_id = target qua GUC). Cùng commit/rollback.
      await this.db.withTenant(job.targetTenantId, async (tx) => {
        const changed = await this.repo.markDoneTx(tx, job.id, key, rows.length);
        if (changed === 0) {
          // Không còn 'running' (đã finalize bởi run khác) — KHÔNG ghi audit trùng, rollback.
          throw new ConcurrentFinalizeError(job.id);
        }
        await this.operatorAudit.recordOperatorAction(tx, {
          operatorId: job.requesterUserId,
          targetTenantId: job.targetTenantId,
          action: AUDIT_DB_EXPORT,
          objectId: job.id,
          after: { table, status: "done", rowCount: rows.length },
        });
      });
      return true;
    } catch (err) {
      if (err instanceof ConcurrentFinalizeError) {
        // Job đã terminal bởi run khác (gần như bất khả thi do claim atomic). KHÔNG dọn object: key tất định
        // theo jobId ⇒ object là của RUN THẮNG (cùng key) — xoá sẽ phá file của nó.
        this.logger.warn(`export job ${job.id} đã finalize bởi run khác — bỏ qua.`);
        return false;
      }
      // Chi tiết đầy đủ (có thể chứa filter value) CHỈ vào server log, KHÔNG vào DB (BẤT BIẾN #3).
      const detail = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `export job ${job.id} THẤT BẠI: ${detail}`,
        err instanceof Error ? err.stack : undefined,
      );
      // Nếu đã upload TRƯỚC khi finalize fail (DB lỗi): dọn object thừa (chống orphan — job sẽ thành 'failed',
      // không ai download được). An toàn vì claim atomic ⇒ run này độc quyền job ⇒ object này là của nó.
      await this.cleanupOrphan(uploadedKey);
      await this.failJob(job, EXPORT_FAILED_MESSAGE);
      return false;
    }
  }

  /** Best-effort xoá object export thừa (compensation). KHÔNG ném — log nếu fail (cần ops nếu lặp lại). */
  private async cleanupOrphan(key: string | null): Promise<void> {
    if (!key) return;
    try {
      await this.storage.deleteObject(key);
    } catch (delErr) {
      this.logger.error(
        `dọn object export thừa ${key} THẤT BẠI (orphan còn lại): ${delErr instanceof Error ? delErr.message : String(delErr)}`,
      );
    }
  }

  /** markFailed + audit failure ATOMIC trong withTenant(target). Lỗi finalize-fail cũng KHÔNG ném ra batch. */
  private async failJob(job: DbExportJobRow, message: string): Promise<void> {
    try {
      await this.db.withTenant(job.targetTenantId, async (tx) => {
        const changed = await this.repo.markFailedTx(tx, job.id, message);
        if (changed === 0) return; // không còn 'running' — không audit trùng
        await this.operatorAudit.recordOperatorAction(tx, {
          operatorId: job.requesterUserId,
          targetTenantId: job.targetTenantId,
          action: AUDIT_DB_EXPORT,
          objectId: job.id,
          after: { table: job.tableName, status: "failed" },
        });
      });
    } catch (finalizeErr) {
      // KHÔNG nuốt im lặng: log ERROR có stack. Job kẹt 'running' sẽ KHÔNG re-claim (claim chỉ 'queued') —
      // chấp nhận (mirror outbox stale-reaper là việc khác); cần ops can thiệp nếu finalize-fail lặp lại.
      this.logger.error(
        `export job ${job.id} markFailed THẤT BẠI: ${finalizeErr instanceof Error ? finalizeErr.message : String(finalizeErr)}`,
        finalizeErr instanceof Error ? finalizeErr.stack : undefined,
      );
    }
  }

  /**
   * Validate filter từ job row. Defensive (createJob đã validate ở API) — job row đọc lại từ DB có thể
   * corrupt/drift. GUARD column/value PHẢI là string non-empty (KHÔNG coerce undefined→'' im lặng = lọc nhầm
   * rows có cột rỗng). Cột PHẢI ∈ allowlist (default-DENY). Lỗi ⇒ ném ⇒ job 'failed' (KHÔNG export sai tập).
   */
  private parseFilters(
    table: DbBrowserTable,
    filter: unknown,
  ): Array<{ column: string; value: string }> {
    if (filter == null) return [];
    if (!Array.isArray(filter)) {
      throw new Error(`Filter của job không phải mảng (table '${table}').`);
    }
    return filter.map((f) => {
      const rawCol = (f as { column?: unknown }).column;
      const rawVal = (f as { value?: unknown }).value;
      if (typeof rawCol !== "string" || rawCol.length === 0) {
        throw new Error(`Filter thiếu 'column' hợp lệ (table '${table}').`);
      }
      if (typeof rawVal !== "string") {
        throw new Error(`Filter '${rawCol}' thiếu 'value' dạng string.`);
      }
      if (!isAllowedColumn(table, rawCol)) {
        throw new Error(`Cột filter '${rawCol}' ngoài allowlist của '${table}'.`);
      }
      return { column: rawCol, value: rawVal };
    });
  }

  /** SELECT cột allowlist + filter = (bind-param) + LIMIT cap. table/columns là identifier allowlist tường minh. */
  private async readRows(
    tx: TenantTx,
    table: DbBrowserTable,
    columns: string[],
    filters: Array<{ column: string; value: string }>,
  ): Promise<Array<Record<string, unknown>>> {
    const colList = sql.join(
      columns.map((c) => sql.identifier(c)),
      sql`, `,
    );
    const tableId = sql.identifier(table);
    const whereParts = filters.map((f) => sql`${sql.identifier(f.column)} = ${f.value}`);
    const whereClause =
      whereParts.length > 0 ? sql` WHERE ${sql.join(whereParts, sql` AND `)}` : sql``;
    const orderBy = sql` ORDER BY ${sql.identifier("created_at")} DESC, ${sql.identifier("id")} DESC`;
    const query = sql`SELECT ${colList} FROM ${tableId}${whereClause}${orderBy} LIMIT ${DB_EXPORT_MAX_ROWS}`;
    const res = await tx.execute(query);
    return res.rows as Array<Record<string, unknown>>;
  }
}

/** Báo hiệu job không còn 'running' khi finalize (đua/idempotency) — không phải lỗi thật. */
class ConcurrentFinalizeError extends Error {
  constructor(jobId: string) {
    super(`export job ${jobId} không còn 'running' khi finalize`);
    this.name = "ConcurrentFinalizeError";
  }
}

/** Serialize rows → CSV (RFC4180-ish): header = columns; escape field chứa quote/comma/newline. */
function toCsv(columns: string[], rows: Array<Record<string, unknown>>): string {
  const lines = [columns.map(csvField).join(",")];
  for (const row of rows) {
    lines.push(columns.map((c) => csvField(stringifyCell(row[c]))).join(","));
  }
  // CRLF theo RFC4180.
  return lines.join("\r\n");
}

function stringifyCell(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** Quote field nếu chứa `"` , `,`, CR hoặc LF; double-up quote bên trong. */
function csvField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
