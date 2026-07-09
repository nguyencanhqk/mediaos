import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import {
  FOUNDATION_FILE_ERROR_CODES,
  type DownloadUrlDto,
  type EmployeeFileDto,
  type ListEmployeeFilesQuery,
} from "@mediaos/contracts";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { DataScopeService } from "../permission/data-scope.service";
import { FileService } from "../foundation/files/files.service";
import {
  EMPLOYEE_ENTITY,
  HR_MODULE,
  EmployeeFileRepository,
  type EmployeeFileRow,
} from "./employee-file.repository";

type RequestUser = { id: string; companyId: string };

/** resourceType + actions for employee-file data_scope (matches seed mig 0477). */
const EMPLOYEE_RESOURCE = "employee";
const ACTION_VIEW = "file-view";
const ACTION_UPLOAD = "file-upload";
const ACTION_DELETE = "file-delete";

/**
 * scan_status values that MAY be downloaded. STRICTER than FileService's own state-guard (which only
 * blocks Infected + not-Uploaded): an employee document must be Clean or NotRequired — Pending/Failed/
 * Infected all 409 BEFORE a signed URL is minted (defense against serving unscanned PII).
 */
const DOWNLOADABLE_SCAN = new Set(["Clean", "NotRequired"]);

/**
 * S2-HR-EMPFILE-1 — Employee File service (hồ sơ đính kèm nhân viên). API-03 HR-API-801..805.
 * Crown-jewel touch points:
 *  - BẤT BIẾN #1: every read/write runs in withTenant(user.companyId); the repo ANDs company_id; RLS+FORCE
 *    is the final wall. cross-tenant employee/file ⇒ RLS 0-row ⇒ 404 (no leak).
 *  - IDOR: assertReadScope/assertWriteScope resolve the data_scope for the file-* pair and isEmployeeInScope
 *    the target employee_profile; findLinkedFileTx proves the file belongs to THIS employee (cross-employee
 *    → 404). Out-of-scope / not-found ⇒ 404 (never 403-after-200, never oracle).
 *  - BẤT BIẾN #2: no own audit object_type — FileService owns file_link/file soft-delete + FileLinked/
 *    FileDeleted audit (append-only) + Link/Download/Delete access-log, all in its own tenant tx.
 *  - Scan-guard: download only for Clean/NotRequired (409 otherwise) BEFORE FileService.getDownloadUrl.
 *
 * The controller's @RequirePermission('file-*','employee') is the COARSE gate (403 when no grant at all).
 * This service adds the FINE data_scope narrowing + per-employee ownership check.
 */
@Injectable()
export class EmployeeFileService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: EmployeeFileRepository,
    private readonly dataScope: DataScopeService,
    private readonly files: FileService,
  ) {}

  // ── List ────────────────────────────────────────────────────────────────────

  async list(
    user: RequestUser,
    employeeId: string,
    query: ListEmployeeFilesQuery,
  ): Promise<EmployeeFileDto[]> {
    await this.assertScope(user, employeeId, ACTION_VIEW);
    return this.db.withTenant(user.companyId, async (tx) => {
      const rows = await this.repo.listByEmployeeTx(tx, user.companyId, employeeId, query.category);
      return rows.map((r) => this.toDto(r));
    });
  }

  // ── Metadata (single) ─────────────────────────────────────────────────────────

  async getMetadata(
    user: RequestUser,
    employeeId: string,
    fileId: string,
  ): Promise<EmployeeFileDto> {
    await this.assertScope(user, employeeId, ACTION_VIEW);
    const row = await this.loadLinkedFileOr404(user, employeeId, fileId);
    return this.toDto(row);
  }

  // ── Download (signed URL, TTL-ngắn) ─────────────────────────────────────────────

  async getDownloadUrl(
    user: RequestUser,
    employeeId: string,
    fileId: string,
  ): Promise<DownloadUrlDto> {
    await this.assertScope(user, employeeId, ACTION_VIEW);
    const row = await this.loadLinkedFileOr404(user, employeeId, fileId);

    // STRICT scan-guard BEFORE FileService: only Clean/NotRequired may be presigned (409 otherwise).
    if (!DOWNLOADABLE_SCAN.has(row.scanStatus)) {
      throw new ConflictException({
        code: FOUNDATION_FILE_ERROR_CODES.NOT_DOWNLOADABLE,
        message: `${FOUNDATION_FILE_ERROR_CODES.NOT_DOWNLOADABLE}: file chưa quét sạch (scan_status=${row.scanStatus}).`,
      });
    }

    // FileService re-checks authorization (resolver) + upload-state-guard + writes the Download access-log.
    return this.files.getDownloadUrl(user, fileId);
  }

  // ── Link (attach an already uploaded+confirmed file) ────────────────────────────

  async link(
    user: RequestUser,
    employeeId: string,
    fileId: string,
    category?: string,
  ): Promise<EmployeeFileDto> {
    await this.assertScope(user, employeeId, ACTION_UPLOAD);

    // FileService.link: resolver gate (canLinkFile) + validate file tenant/scan + insert file_links +
    // audit FileLinked (object_type 'file_link') + access-log Link — all in its own tenant tx.
    await this.files.link(user, {
      fileId,
      moduleCode: HR_MODULE,
      entityType: EMPLOYEE_ENTITY,
      entityId: employeeId,
      linkType: "Document",
      accessScope: "Company",
      isPrimary: false,
      purpose: category,
    });

    const row = await this.loadLinkedFileOr404(user, employeeId, fileId);
    return this.toDto(row);
  }

  // ── Delete (soft) ────────────────────────────────────────────────────────────

  async delete(user: RequestUser, employeeId: string, fileId: string): Promise<void> {
    await this.assertScope(user, employeeId, ACTION_DELETE);
    // Prove the file belongs to THIS employee (cross-employee → 404) before FileService soft-deletes it.
    await this.loadLinkedFileOr404(user, employeeId, fileId);

    // FileService.deleteFile: resolver gate (canDeleteFile) + soft-delete files (deleted_at) + audit
    // FileDeleted (object_type 'file') + access-log Delete. Removes it from the list (files.deleted_at).
    await this.files.deleteFile(user, fileId);
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  /**
   * FINE data_scope narrowing over the target employee_profile. resolveAndAssert throws Forbidden only when
   * the caller has NO grant (already gated by PermissionGuard on the route, so normally passes). Then load
   * the employee scope-target inside the tenant tx and isEmployeeInScope — out-of-scope / cross-tenant
   * (RLS 0-row) / not-found ⇒ 404 (never 403-after-200, never leak existence).
   */
  private async assertScope(user: RequestUser, employeeId: string, action: string): Promise<void> {
    const scope = await this.dataScope.resolveAndAssert(
      user.id,
      user.companyId,
      action,
      EMPLOYEE_RESOURCE,
    );
    const ctx = await this.dataScope.resolveContext(user.id, user.companyId);
    const inScope = await this.db.withTenant(user.companyId, async (tx) => {
      const target = await this.repo.findEmployeeScopeTargetTx(tx, user.companyId, employeeId);
      if (!target) return false;
      return this.dataScope.isEmployeeInScope(scope, ctx, {
        userId: target.userId,
        companyId: target.companyId,
        orgUnitId: target.orgUnitId,
        directManagerUserId: target.directManagerUserId,
      });
    });
    if (!inScope) throw new NotFoundException("Employee not found");
  }

  /** Load the one file linked to `employeeId` (soft-delete filtered) or 404 (cross-employee/gone/leak). */
  private async loadLinkedFileOr404(
    user: RequestUser,
    employeeId: string,
    fileId: string,
  ): Promise<EmployeeFileRow> {
    const row = await this.db.withTenant(user.companyId, (tx) =>
      this.repo.findLinkedFileTx(tx, user.companyId, employeeId, fileId),
    );
    if (!row) throw new NotFoundException("File not found");
    return row;
  }

  private toDto(row: EmployeeFileRow): EmployeeFileDto {
    return {
      linkId: row.linkId,
      fileId: row.fileId,
      originalName: row.originalName,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
      scanStatus: row.scanStatus as EmployeeFileDto["scanStatus"],
      uploadStatus: row.uploadStatus as EmployeeFileDto["uploadStatus"],
      uploadedAt: row.uploadedAt.toISOString(),
      category: row.category,
    };
  }
}
