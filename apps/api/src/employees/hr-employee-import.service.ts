import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import {
  hrEmployeeImportRowSchema,
  IMPORT_COLUMN_ORDER,
  type HrEmployeeImportRow,
  type HrImportCreatedRow,
  type HrImportReport,
  type HrImportResult,
  type HrImportRowError,
} from "@mediaos/contracts";
import { z } from "zod";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { DataScopeService } from "../permission/data-scope.service";
import { HrEmployeeImportRepository } from "./hr-import.repository";
import { HrImportParser, type ImportFileKind } from "./hr-import.parser";
import { HrWriteService, type ImportEmployeeCreateData } from "./hr-write.service";

/** Multer limits SIZE at the interceptor; the service re-checks explicitly so a bypass still 400s. */
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
/** Bound the batch — an unbounded file would hold a connection per row for the whole apply run. */
export const MAX_IMPORT_ROWS = 5000;

/** Import is inherently company-wide; only a Company/System data_scope may perform it (defense-in-depth). */
const IMPORT_SCOPES: ReadonlySet<string> = new Set(["Company", "System"]);

// Accept a modest MIME set per extension; the real gate is content parsing (parser → 400, never 500).
const CSV_MIMES: ReadonlySet<string> = new Set([
  "text/csv",
  "application/csv",
  "application/vnd.ms-excel",
  "text/plain",
]);
const XLSX_MIMES: ReadonlySet<string> = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/octet-stream",
  "application/zip",
  "application/vnd.ms-excel",
]);

/** The multer file shape the service needs (subset of Express.Multer.File). */
export interface ImportUpload {
  originalname?: string;
  mimetype?: string;
  size?: number;
  buffer: Buffer;
}

interface ParsedRow {
  row: number;
  data: HrEmployeeImportRow;
}
interface ResolvedRow {
  row: number;
  create: ImportEmployeeCreateData;
}

/**
 * S5-HR-IMPORT-BE-1 — HR bulk employee import (SPEC-03 §7 / HR.EMPLOYEE.IMPORT). Crown-jewel:
 *  - BẤT BIẾN #1: every DB touch runs in `withTenant(user.companyId)`; resolution + dup checks are
 *    tenant-scoped, so an actor of company A can never read/write company B.
 *  - dryRun (the SAFE default): validates the whole file WITHOUT writing — no insert, no SequenceService
 *    call (no sequence_counters jump), zero audit.
 *  - apply: PARTIAL-SUCCESS — each valid row is created in its OWN tx via HrWriteService.createFromImportTx
 *    (UNLINKED, never provisions a login account, no outbox); a bad row is skipped + reported, never rolls
 *    back the others. Exactly ONE `employee_import` session audit ({fileName, ok, fail}) is written AFTER
 *    the loop — no PII/secret in it (BẤT BIẾN #3).
 *
 * Permission is gated by the controller (PermissionGuard import:employee, isSensitive). assertImportScope
 * re-derives the caller's strongest scope and FAIL-CLOSES unless Company/System (so a future sub-Company
 * grant can't silently make import a company-wide leak).
 */
@Injectable()
export class HrEmployeeImportService {
  constructor(
    private readonly db: DatabaseService,
    private readonly importRepo: HrEmployeeImportRepository,
    private readonly hrWrite: HrWriteService,
    private readonly parser: HrImportParser,
    private readonly dataScope: DataScopeService,
  ) {}

  async import(
    user: { id: string; companyId: string },
    file: ImportUpload | undefined,
    dryRun: boolean,
  ): Promise<HrImportReport | HrImportResult> {
    await this.assertImportScope(user);
    const kind = this.resolveFileKind(file);
    const fileName = this.safeFileName(file);
    const matrix = await this.parser.parse(file!.buffer, kind);

    // Row 0 is the header (labels are human-editable → mapped by POSITION, never trusted). Data rows only.
    const dataMatrix = matrix.slice(1);
    if (dataMatrix.length === 0) {
      throw new BadRequestException("HR-ERR-IMPORT-EMPTY: the file has no data rows");
    }
    if (dataMatrix.length > MAX_IMPORT_ROWS) {
      throw new BadRequestException(
        `HR-ERR-IMPORT-TOO-MANY: at most ${MAX_IMPORT_ROWS} rows per import`,
      );
    }

    const errors: HrImportRowError[] = [];
    const parsed = this.validateRows(dataMatrix, errors);
    const survivors = this.dropInFileDuplicates(parsed, errors);
    const resolved = await this.resolveRows(user.companyId, survivors, errors);

    if (dryRun) {
      const report: HrImportReport = {
        dryRun: true,
        fileName,
        counts: { ok: resolved.length, fail: errors.length },
        errors: this.byRow(errors),
      };
      return report;
    }
    return this.apply(user, fileName, resolved, errors);
  }

  /** Downloadable CSV template — header + one example row, columns straight from IMPORT_COLUMN_ORDER. */
  getTemplateCsv(): string {
    const header = IMPORT_COLUMN_ORDER.map((c) => this.csvCell(c.header)).join(",");
    const example = IMPORT_COLUMN_ORDER.map((c) => this.csvCell(c.example)).join(",");
    // Prefix a UTF-8 BOM so Excel renders the Vietnamese headers correctly.
    return String.fromCharCode(0xfeff) + header + "\r\n" + example + "\r\n";
  }

  // ── Steps ────────────────────────────────────────────────────────────────────────

  private async assertImportScope(user: { id: string; companyId: string }): Promise<void> {
    const scope = await this.dataScope.resolveAndAssert(
      user.id,
      user.companyId,
      "import",
      "employee",
    );
    if (!IMPORT_SCOPES.has(scope)) {
      throw new ForbiddenException("AUTH-ERR-SCOPE-DENIED: employee import requires Company scope");
    }
  }

  /** Validate file presence/size/extension/MIME explicitly → 400 (never a raw 500 on a bad upload). */
  private resolveFileKind(file: ImportUpload | undefined): ImportFileKind {
    if (!file || !file.buffer || file.buffer.length === 0) {
      throw new BadRequestException("HR-ERR-IMPORT-NO-FILE: no file uploaded");
    }
    const size = file.size ?? file.buffer.length;
    if (size > MAX_IMPORT_BYTES) {
      throw new BadRequestException("HR-ERR-IMPORT-TOO-LARGE: file exceeds 5MB");
    }
    const name = (file.originalname ?? "").toLowerCase();
    const dot = name.lastIndexOf(".");
    const ext = dot >= 0 ? name.slice(dot) : "";
    const mime = (file.mimetype ?? "").toLowerCase();
    if (ext === ".csv") {
      if (!CSV_MIMES.has(mime)) {
        throw new BadRequestException("HR-ERR-IMPORT-FILE-TYPE: MIME does not match a CSV file");
      }
      return "csv";
    }
    if (ext === ".xlsx") {
      if (!XLSX_MIMES.has(mime)) {
        throw new BadRequestException("HR-ERR-IMPORT-FILE-TYPE: MIME does not match an XLSX file");
      }
      return "xlsx";
    }
    throw new BadRequestException(
      "HR-ERR-IMPORT-FILE-TYPE: only .xlsx or .csv files are supported",
    );
  }

  /** Schema-validate each data row (keyed by position). Failures accumulate into `errors`. */
  private validateRows(dataMatrix: string[][], errors: HrImportRowError[]): ParsedRow[] {
    const parsed: ParsedRow[] = [];
    dataMatrix.forEach((cells, idx) => {
      const rowNo = idx + 1; // 1-based DATA row (header excluded).
      const result = hrEmployeeImportRowSchema.safeParse(this.mapRow(cells));
      if (result.success) {
        parsed.push({ row: rowNo, data: result.data });
      } else {
        errors.push({ row: rowNo, errors: this.zodMessages(result.error) });
      }
    });
    return parsed;
  }

  /** Map a positional cell array to a row record; blank cells are omitted so schema defaults apply. */
  private mapRow(cells: string[]): Record<string, string> {
    const record: Record<string, string> = {};
    IMPORT_COLUMN_ORDER.forEach((col, i) => {
      const val = typeof cells[i] === "string" ? cells[i].trim() : "";
      if (val !== "") record[col.key] = val;
    });
    return record;
  }

  /** Flag EVERY row that shares an email or employeeCode with another row in the same file. */
  private dropInFileDuplicates(parsed: ParsedRow[], errors: HrImportRowError[]): ParsedRow[] {
    const byEmail = new Map<string, number[]>();
    const byCode = new Map<string, number[]>();
    for (const p of parsed) {
      if (p.data.email) this.pushInto(byEmail, p.data.email.toLowerCase(), p.row);
      if (p.data.employeeCode) this.pushInto(byCode, p.data.employeeCode, p.row);
    }
    const dupMsgs = new Map<number, string[]>();
    for (const [email, rows] of byEmail) {
      if (rows.length > 1)
        rows.forEach((r) => this.pushInto(dupMsgs, r, `Email '${email}' bị trùng trong file`));
    }
    for (const [code, rows] of byCode) {
      if (rows.length > 1)
        rows.forEach((r) =>
          this.pushInto(dupMsgs, r, `Mã nhân viên '${code}' bị trùng trong file`),
        );
    }
    const survivors: ParsedRow[] = [];
    for (const p of parsed) {
      const msgs = dupMsgs.get(p.row);
      if (msgs) errors.push({ row: p.row, errors: msgs });
      else survivors.push(p);
    }
    return survivors;
  }

  /**
   * Resolve reference NAMES → ids and run DB dup checks in ONE tenant read tx. A row that fails resolution
   * or hits a DB duplicate is reported (and NOT returned for apply). No writes here — dryRun stops after this.
   */
  private async resolveRows(
    companyId: string,
    survivors: ParsedRow[],
    errors: HrImportRowError[],
  ): Promise<ResolvedRow[]> {
    if (survivors.length === 0) return [];
    const resolved: ResolvedRow[] = [];
    await this.db.withTenant(companyId, async (tx) => {
      for (const p of survivors) {
        const rowErrors: string[] = [];
        const create = await this.resolveRow(tx, companyId, p.data, rowErrors);
        if (rowErrors.length > 0) errors.push({ row: p.row, errors: rowErrors });
        else resolved.push({ row: p.row, create });
      }
    });
    return resolved;
  }

  private async resolveRow(
    tx: TenantTx,
    companyId: string,
    data: HrEmployeeImportRow,
    rowErrors: string[],
  ): Promise<ImportEmployeeCreateData> {
    const orgUnitId = await this.resolveRef(
      data.orgUnitName,
      (n) => this.importRepo.findOrgUnitIdByNameTx(tx, companyId, n),
      "Phòng ban",
      rowErrors,
    );
    const positionId = await this.resolveRef(
      data.positionName,
      (n) => this.importRepo.findPositionIdByNameTx(tx, companyId, n),
      "Chức danh",
      rowErrors,
    );
    const jobLevelId = await this.resolveRef(
      data.jobLevelName,
      (n) => this.importRepo.findJobLevelIdByNameTx(tx, companyId, n),
      "Cấp bậc",
      rowErrors,
    );
    const contractTypeId = await this.resolveRef(
      data.contractTypeName,
      (n) => this.importRepo.findContractTypeIdByNameTx(tx, companyId, n),
      "Loại hợp đồng",
      rowErrors,
    );
    if (
      data.employeeCode &&
      (await this.importRepo.employeeCodeInUseTx(tx, companyId, data.employeeCode))
    ) {
      rowErrors.push(`Mã nhân viên '${data.employeeCode}' đã tồn tại`);
    }
    if (data.email && (await this.importRepo.userEmailExistsTx(tx, companyId, data.email))) {
      rowErrors.push(`Email '${data.email}' đã thuộc về một tài khoản`);
    }
    return {
      employeeCode: data.employeeCode ?? null,
      orgUnitId,
      positionId,
      jobLevelId,
      contractTypeId,
      workType: data.workType,
      employmentType: data.employmentType,
      salaryType: data.salaryType,
      startDate: data.startDate ?? null,
      endDate: data.endDate ?? null,
    };
  }

  private async resolveRef(
    name: string | undefined,
    lookup: (name: string) => Promise<string | undefined>,
    label: string,
    rowErrors: string[],
  ): Promise<string | null> {
    if (!name) return null;
    const id = await lookup(name);
    if (!id) {
      rowErrors.push(`${label} '${name}' không tồn tại hoặc không hoạt động`);
      return null;
    }
    return id;
  }

  /** apply: create each resolved row in its OWN tx (partial-success), then write ONE session audit. */
  private async apply(
    user: { id: string; companyId: string },
    fileName: string,
    resolved: ResolvedRow[],
    preErrors: HrImportRowError[],
  ): Promise<HrImportResult> {
    const created: HrImportCreatedRow[] = [];
    const skipped: HrImportRowError[] = [...preErrors];
    for (const r of resolved) {
      try {
        const res = await this.hrWrite.createFromImportTx(user, r.create);
        created.push({ row: r.row, employeeId: res.id, employeeCode: res.employeeCode });
      } catch (err) {
        skipped.push({ row: r.row, errors: [this.errorMessage(err)] });
      }
    }
    const sessionAuditId = await this.db.withTenant(user.companyId, (tx) =>
      this.importRepo.insertSessionAuditTx(tx, {
        actorUserId: user.id,
        fileName,
        ok: created.length,
        fail: skipped.length,
      }),
    );
    return {
      dryRun: false,
      fileName,
      counts: { ok: created.length, fail: skipped.length },
      created: [...created].sort((a, b) => a.row - b.row),
      skipped: this.byRow(skipped),
      sessionAuditId,
    };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────────

  private zodMessages(error: z.ZodError): string[] {
    return error.errors.map((e) => `${e.path.join(".") || "row"}: ${e.message}`);
  }

  private errorMessage(err: unknown): string {
    if (err instanceof Error && typeof err.message === "string") return err.message;
    return "Không thể tạo nhân viên";
  }

  private byRow(errs: HrImportRowError[]): HrImportRowError[] {
    return [...errs].sort((a, b) => a.row - b.row);
  }

  private pushInto<K, V>(map: Map<K, V[]>, key: K, value: V): void {
    const list = map.get(key);
    if (list) list.push(value);
    else map.set(key, [value]);
  }

  private safeFileName(file: ImportUpload | undefined): string {
    const raw = file?.originalname?.trim();
    return raw && raw.length > 0 ? raw.slice(0, 255) : "import";
  }

  private csvCell(value: string): string {
    if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
    return value;
  }
}
