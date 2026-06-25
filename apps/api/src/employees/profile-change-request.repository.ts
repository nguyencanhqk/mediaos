import { Injectable } from "@nestjs/common";
import { and, desc, eq, isNull } from "drizzle-orm";
import { DatabaseService, type TenantTx } from "../db/db.service";
import {
  employeeProfileChangeHistories,
  employeeProfiles,
  profileChangeRequests,
  users,
} from "../db/schema";

/** Columns for a list row — no sensitive fields from old/new values. */
const LIST_COLUMNS = {
  id: profileChangeRequests.id,
  employeeId: profileChangeRequests.employeeId,
  requestedBy: profileChangeRequests.requestedBy,
  status: profileChangeRequests.status,
  changedFields: profileChangeRequests.changedFields,
  reason: profileChangeRequests.reason,
  submittedAt: profileChangeRequests.submittedAt,
  reviewedAt: profileChangeRequests.reviewedAt,
  createdAt: profileChangeRequests.createdAt,
  employeeCode: employeeProfiles.employeeCode,
} as const;

/** Columns for detail — includes old/new values (masked by service/audit masker). */
const DETAIL_COLUMNS = {
  id: profileChangeRequests.id,
  companyId: profileChangeRequests.companyId,
  employeeId: profileChangeRequests.employeeId,
  requestedBy: profileChangeRequests.requestedBy,
  status: profileChangeRequests.status,
  oldValues: profileChangeRequests.oldValues,
  newValues: profileChangeRequests.newValues,
  changedFields: profileChangeRequests.changedFields,
  reason: profileChangeRequests.reason,
  rejectionReason: profileChangeRequests.rejectionReason,
  reviewedBy: profileChangeRequests.reviewedBy,
  reviewedAt: profileChangeRequests.reviewedAt,
  submittedAt: profileChangeRequests.submittedAt,
  cancelledAt: profileChangeRequests.cancelledAt,
  createdAt: profileChangeRequests.createdAt,
  updatedAt: profileChangeRequests.updatedAt,
  employeeCode: employeeProfiles.employeeCode,
} as const;

export interface CreateRequestData {
  employeeId: string;
  requestedBy: string;
  oldValues: Record<string, unknown>;
  newValues: Record<string, unknown>;
  changedFields: string[];
  reason?: string | null;
}

export interface UpdateRequestStatusData {
  status: string;
  reviewedBy?: string | null;
  rejectionReason?: string | null;
  cancelledAt?: Date | null;
}

export interface ListRequestsFilter {
  page: number;
  pageSize: number;
  status?: string;
  employeeId?: string;
}

export interface EmployeeSnapshot {
  id: string;
  companyId: string;
  userId: string;
  phone: string | null;
  avatarUrl: string | null;
  notes: string | null;
  // S2-HR-BE-4 (mig 0451): 11 cột self-service — old_values snapshot phản ánh đúng giá trị hiện tại.
  dateOfBirth: string | null;
  gender: string | null;
  maritalStatus: string | null;
  personalEmail: string | null;
  currentAddress: string | null;
  permanentAddress: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  identityNumber: string | null;
  identityIssueDate: string | null;
  identityIssuePlace: string | null;
}

/** One field-level history entry to append when a request is approved. */
export interface ProfileChangeHistoryEntry {
  fieldName: string;
  oldValue: unknown;
  newValue: unknown;
  isSensitive: boolean;
}

/** Batch of history rows written in the same approval tx (append-only). */
export interface WriteHistoryData {
  employeeId: string;
  requestId: string;
  changedBy: string;
  entries: ProfileChangeHistoryEntry[];
}

/**
 * Single source of truth: SPEC-03 allowed field name → employee_profiles Drizzle column key.
 * All 11 self-service fields now have real columns (mig 0451). Unknown keys map to null →
 * silently ignored by apply (defense-in-depth; the service validates changedFields first).
 */
export const FIELD_TO_COLUMN: Record<string, keyof typeof employeeProfiles.$inferInsert> = {
  phone: "phone",
  avatar_file_id: "avatarUrl", // stored as avatarUrl in the current schema
  notes: "notes",
  date_of_birth: "dateOfBirth",
  gender: "gender",
  marital_status: "maritalStatus",
  personal_email: "personalEmail",
  current_address: "currentAddress",
  permanent_address: "permanentAddress",
  emergency_contact_name: "emergencyContactName",
  emergency_contact_phone: "emergencyContactPhone",
  identity_number: "identityNumber",
  identity_issue_date: "identityIssueDate",
  identity_issue_place: "identityIssuePlace",
};

/** Full shape returned by detail query (includes joined columns). */
export interface PcrDetailRow {
  id: string;
  companyId: string;
  employeeId: string;
  requestedBy: string;
  status: string;
  oldValues: Record<string, unknown>;
  newValues: Record<string, unknown>;
  changedFields: string[];
  reason: string | null;
  rejectionReason: string | null;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  submittedAt: Date;
  cancelledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  employeeCode: string | null;
}

/**
 * S2-HR-BE-4 — Repository for profile_change_requests.
 * ALL methods run INSIDE a withTenant tx supplied by the service (BẤT BIẾN #1).
 * No method opens its own connection — prevents cross-tenant data leaks via unscoped queries.
 */
@Injectable()
export class ProfileChangeRequestRepository {
  constructor(private readonly db: DatabaseService) {}

  // ── Employee lookup (by user_id, for Own-scope enforcement) ────────────────────

  async findEmployeeByUserIdTx(
    tx: TenantTx,
    companyId: string,
    userId: string,
  ): Promise<EmployeeSnapshot | null> {
    const [row] = await tx
      .select({
        id: employeeProfiles.id,
        companyId: employeeProfiles.companyId,
        userId: employeeProfiles.userId,
        phone: employeeProfiles.phone,
        avatarUrl: employeeProfiles.avatarUrl,
        notes: employeeProfiles.notes,
        dateOfBirth: employeeProfiles.dateOfBirth,
        gender: employeeProfiles.gender,
        maritalStatus: employeeProfiles.maritalStatus,
        personalEmail: employeeProfiles.personalEmail,
        currentAddress: employeeProfiles.currentAddress,
        permanentAddress: employeeProfiles.permanentAddress,
        emergencyContactName: employeeProfiles.emergencyContactName,
        emergencyContactPhone: employeeProfiles.emergencyContactPhone,
        identityNumber: employeeProfiles.identityNumber,
        identityIssueDate: employeeProfiles.identityIssueDate,
        identityIssuePlace: employeeProfiles.identityIssuePlace,
      })
      .from(employeeProfiles)
      .where(
        and(
          eq(employeeProfiles.companyId, companyId),
          eq(employeeProfiles.userId, userId),
          isNull(employeeProfiles.deletedAt),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  // ── Create ────────────────────────────────────────────────────────────────────

  async createRequestTx(
    tx: TenantTx,
    companyId: string,
    data: CreateRequestData,
  ): Promise<PcrDetailRow> {
    const [row] = await tx
      .insert(profileChangeRequests)
      .values({
        companyId,
        employeeId: data.employeeId,
        requestedBy: data.requestedBy,
        status: "Pending",
        oldValues: data.oldValues,
        newValues: data.newValues,
        changedFields: data.changedFields,
        reason: data.reason ?? null,
        submittedAt: new Date(),
      })
      .returning();

    if (!row) throw new Error("Failed to create profile change request");
    return { ...row, employeeCode: null } as PcrDetailRow;
  }

  // ── Read ──────────────────────────────────────────────────────────────────────

  async findRequestByIdTx(
    tx: TenantTx,
    companyId: string,
    id: string,
  ): Promise<PcrDetailRow | null> {
    const [row] = await tx
      .select(DETAIL_COLUMNS)
      .from(profileChangeRequests)
      .leftJoin(employeeProfiles, eq(profileChangeRequests.employeeId, employeeProfiles.id))
      .where(and(eq(profileChangeRequests.companyId, companyId), eq(profileChangeRequests.id, id)))
      .limit(1);
    return (row as PcrDetailRow | undefined) ?? null;
  }

  async listRequestsTx(
    tx: TenantTx,
    companyId: string,
    filter: ListRequestsFilter,
  ): Promise<{ rows: (typeof LIST_COLUMNS extends infer T ? T : never)[]; total: number }> {
    const conds = [eq(profileChangeRequests.companyId, companyId)];
    if (filter.status) conds.push(eq(profileChangeRequests.status, filter.status));
    if (filter.employeeId) conds.push(eq(profileChangeRequests.employeeId, filter.employeeId));

    const where = and(...(conds as [(typeof conds)[0], ...typeof conds]));

    const countRows = await tx
      .select({ id: profileChangeRequests.id })
      .from(profileChangeRequests)
      .where(where);
    const total = countRows.length;

    const offset = (filter.page - 1) * filter.pageSize;
    const rows = await tx
      .select(LIST_COLUMNS)
      .from(profileChangeRequests)
      .leftJoin(employeeProfiles, eq(profileChangeRequests.employeeId, employeeProfiles.id))
      .where(where)
      .orderBy(desc(profileChangeRequests.submittedAt))
      .limit(filter.pageSize)
      .offset(offset);

    return { rows: rows as never, total };
  }

  async listOwnRequestsTx(
    tx: TenantTx,
    companyId: string,
    employeeId: string,
    filter: Omit<ListRequestsFilter, "employeeId">,
  ): Promise<{ rows: (typeof LIST_COLUMNS extends infer T ? T : never)[]; total: number }> {
    return this.listRequestsTx(tx, companyId, { ...filter, employeeId });
  }

  // ── Status transitions (state-machine advances — NEVER goes back) ─────────────

  async updateRequestStatusTx(
    tx: TenantTx,
    companyId: string,
    id: string,
    data: UpdateRequestStatusData,
  ): Promise<PcrDetailRow> {
    const now = new Date();
    const [row] = await tx
      .update(profileChangeRequests)
      .set({
        status: data.status,
        reviewedBy: data.reviewedBy ?? undefined,
        rejectionReason: data.rejectionReason ?? undefined,
        cancelledAt: data.cancelledAt ?? undefined,
        reviewedAt: data.status === "Approved" || data.status === "Rejected" ? now : undefined,
        updatedAt: now,
      })
      .where(and(eq(profileChangeRequests.companyId, companyId), eq(profileChangeRequests.id, id)))
      .returning();

    if (!row) throw new Error("Failed to update profile change request status");
    return { ...row, employeeCode: null } as PcrDetailRow;
  }

  // ── Apply approved changes to employee record ─────────────────────────────────

  /**
   * Apply the subset of newValues that map to real employee_profiles columns (FIELD_TO_COLUMN).
   * Unknown keys are silently ignored (defense-in-depth: the service already validated
   * changedFields against the allow-list before the request was ever stored).
   * BẤT BIẾN #1: update is scoped to companyId + employeeId (RLS + explicit WHERE).
   */
  async applyChangesToEmployeeTx(
    tx: TenantTx,
    companyId: string,
    employeeId: string,
    newValues: Record<string, unknown>,
  ): Promise<void> {
    const setData: Record<string, unknown> = { updatedAt: new Date() };
    for (const [field, value] of Object.entries(newValues)) {
      const col = FIELD_TO_COLUMN[field];
      if (col) setData[col] = value;
    }

    // If no mapped column has changed, skip the UPDATE (avoids a no-op write).
    const hasChange = Object.keys(setData).length > 1; // > 1 because updatedAt always present
    if (!hasChange) return;

    await tx
      .update(employeeProfiles)
      .set(setData as Partial<typeof employeeProfiles.$inferInsert>)
      .where(
        and(
          eq(employeeProfiles.companyId, companyId),
          eq(employeeProfiles.id, employeeId),
          isNull(employeeProfiles.deletedAt),
        ),
      );
  }

  // ── Append-only history (BẤT BIẾN #2: app role chỉ SELECT,INSERT — KHÔNG UPDATE/DELETE) ──────

  /**
   * Append one employee_profile_change_histories row per applied field, in the SAME approval tx
   * (SPEC-03 §14.12). No-op when entries is empty. BẤT BIẾN #1: company_id scoped (RLS DEFAULT +
   * explicit value). BẤT BIẾN #3: caller masks sensitive values before passing them in — this
   * method does NOT see plaintext identity_number (already "***").
   */
  async writeProfileChangeHistoryTx(
    tx: TenantTx,
    companyId: string,
    data: WriteHistoryData,
  ): Promise<void> {
    if (data.entries.length === 0) return;
    await tx.insert(employeeProfileChangeHistories).values(
      data.entries.map((e) => ({
        companyId,
        employeeId: data.employeeId,
        requestId: data.requestId,
        fieldName: e.fieldName,
        oldValue: e.oldValue,
        newValue: e.newValue,
        isSensitive: e.isSensitive,
        changedBy: data.changedBy,
      })),
    );
  }

  // ── Reviewer name lookup (for response enrichment) ────────────────────────────

  async findUserNameTx(tx: TenantTx, companyId: string, userId: string): Promise<string | null> {
    const [row] = await tx
      .select({ fullName: users.fullName })
      .from(users)
      .where(and(eq(users.companyId, companyId), eq(users.id, userId), isNull(users.deletedAt)))
      .limit(1);
    return row?.fullName ?? null;
  }
}
