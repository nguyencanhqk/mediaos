import { Injectable } from "@nestjs/common";
import { and, desc, eq, isNull } from "drizzle-orm";
import { type TenantTx } from "../db/db.service";
import { employeeProfiles, fileLinks, files } from "../db/schema";

/**
 * S2-HR-EMPFILE-1 — read-only persistence for employee files. The FILE lifecycle (upload/soft-delete)
 * is owned by Foundation FileService (files/file_links); this repo only READS the polymorphic join
 * (module_code='HR', entity_type='employee_profile', entity_id=employeeId) so the HR surface can list a
 * profile's documents and resolve one file for metadata/download/scan-guard.
 *
 * Every method runs INSIDE the caller's tenant tx (withTenant → RLS+FORCE); each WHERE also ANDs
 * company_id (defense-in-depth, BẤT BIẾN #1). Soft-deleted rows are excluded (BẤT BIẾN #2): a link
 * whose file_links.deleted_at OR files.deleted_at is set never appears — proves DELETE removed it from
 * the list without hard-deleting.
 */

/** module_code / entity_type MUST match what EmployeeFileService passes to FileService.link. */
export const HR_MODULE = "HR";
export const EMPLOYEE_ENTITY = "employee_profile";

/** A joined file_links⋈files row surfaced to the service (safe fields only — no storage_path/checksum). */
export interface EmployeeFileRow {
  linkId: string;
  fileId: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  scanStatus: string;
  uploadStatus: string;
  uploadedAt: Date;
  category: string | null;
}

/** employee_profiles fields DataScopeService needs to test Own/Team/Department membership (IDOR guard). */
export interface EmployeeScopeTarget {
  userId: string | null;
  companyId: string;
  orgUnitId: string | null;
  directManagerUserId: string | null;
}

const FILE_COLUMNS = {
  linkId: fileLinks.id,
  fileId: files.id,
  originalName: files.originalName,
  mimeType: files.mimeType,
  sizeBytes: files.fileSizeBytes,
  scanStatus: files.scanStatus,
  uploadStatus: files.uploadStatus,
  uploadedAt: files.uploadedAt,
  category: fileLinks.purpose,
} as const;

@Injectable()
export class EmployeeFileRepository {
  /**
   * List a profile's linked files (soft-delete filtered on BOTH file_links and files), newest first.
   * `category` (optional) filters on file_links.purpose. RLS + explicit company_id keep it tenant-bound.
   */
  async listByEmployeeTx(
    tx: TenantTx,
    companyId: string,
    employeeId: string,
    category?: string,
  ): Promise<EmployeeFileRow[]> {
    const conds = [
      eq(fileLinks.companyId, companyId),
      eq(fileLinks.moduleCode, HR_MODULE),
      eq(fileLinks.entityType, EMPLOYEE_ENTITY),
      eq(fileLinks.entityId, employeeId),
      isNull(fileLinks.deletedAt),
      isNull(files.deletedAt),
    ];
    if (category) conds.push(eq(fileLinks.purpose, category));

    const rows = await tx
      .select(FILE_COLUMNS)
      .from(fileLinks)
      .innerJoin(files, eq(fileLinks.fileId, files.id))
      .where(and(...conds))
      .orderBy(desc(files.uploadedAt));
    return rows as EmployeeFileRow[];
  }

  /**
   * Resolve ONE file that is BOTH linked to `employeeId` AND still live (link + file not soft-deleted).
   * Returns undefined when the file is not linked to THIS employee (cross-employee IDOR) or cross-tenant
   * (RLS 0-row) — the service maps that to 404 (no oracle). Carries scanStatus/uploadStatus for the
   * download scan-guard.
   */
  async findLinkedFileTx(
    tx: TenantTx,
    companyId: string,
    employeeId: string,
    fileId: string,
  ): Promise<EmployeeFileRow | undefined> {
    const [row] = await tx
      .select(FILE_COLUMNS)
      .from(fileLinks)
      .innerJoin(files, eq(fileLinks.fileId, files.id))
      .where(
        and(
          eq(fileLinks.companyId, companyId),
          eq(fileLinks.moduleCode, HR_MODULE),
          eq(fileLinks.entityType, EMPLOYEE_ENTITY),
          eq(fileLinks.entityId, employeeId),
          eq(fileLinks.fileId, fileId),
          isNull(fileLinks.deletedAt),
          isNull(files.deletedAt),
        ),
      )
      .limit(1);
    return row as EmployeeFileRow | undefined;
  }

  /**
   * The employee_profiles scope fields for the target profile — used by assertReadScope/assertWriteScope
   * and the resolver for the isEmployeeInScope IDOR check (mirrors ContractRepository.findScopeTargetTx).
   * undefined ⇒ not found / cross-tenant RLS 0-row ⇒ fail-closed (404).
   */
  async findEmployeeScopeTargetTx(
    tx: TenantTx,
    companyId: string,
    employeeId: string,
  ): Promise<EmployeeScopeTarget | undefined> {
    const [row] = await tx
      .select({
        userId: employeeProfiles.userId,
        companyId: employeeProfiles.companyId,
        orgUnitId: employeeProfiles.orgUnitId,
        directManagerUserId: employeeProfiles.directManagerId,
      })
      .from(employeeProfiles)
      .where(
        and(
          eq(employeeProfiles.id, employeeId),
          eq(employeeProfiles.companyId, companyId),
          isNull(employeeProfiles.deletedAt),
        ),
      )
      .limit(1);
    return row;
  }
}
