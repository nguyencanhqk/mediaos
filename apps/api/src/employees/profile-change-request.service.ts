import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type {
  ApproveProfileChangeRequest,
  CreateProfileChangeRequest,
  ProfileChangeRequestDetail,
  ProfileChangeRequestListItem,
  ProfileChangeRequestListQuery,
  ProfileChangeRequestListResponse,
  RejectProfileChangeRequest,
} from "@mediaos/contracts";
import { AuditService } from "../events/audit.service";
import { DatabaseService } from "../db/db.service";
import { PermissionService } from "../permission/permission.service";
import type {
  ProfileChangeRequestRepository,
  PcrDetailRow,
} from "./profile-change-request.repository";

type RequestUser = { id: string; companyId: string };

/** Fields the employee is NOT allowed to request changes to (SPEC-03 §13.4). */
const FORBIDDEN_FIELDS = new Set([
  "department_id",
  "position_id",
  "job_level_id",
  "direct_manager_id",
  "employment_status",
  "employee_type",
  "contract",
  "role",
  "user_permission",
]);

/**
 * S2-HR-BE-4 — Profile change request business logic (SPEC-03 §14.18/14.19/14.20).
 *
 * BẤT BIẾN #1: every DB write runs inside db.withTenant(companyId, fn).
 * BẤT BIẾN #2: audit INSERT shares the business tx (atomic — no partial audit).
 * BẤT BIẾN #3: oldValues/newValues go through AuditService masker before audit_logs
 *   (identity_number → "***"). The employee record apply also only touches allowed columns.
 *
 * Permission pairs (seeded mig 0444):
 *   create:profile-change-request  (Own — all roles with employee context)
 *   approve:profile-change-request (Company — hr/company-admin)
 *
 * State machine (Pending → Approved | Rejected | Cancelled). Terminal states are final.
 */
@Injectable()
export class ProfileChangeRequestService {
  constructor(
    private readonly repo: ProfileChangeRequestRepository,
    private readonly db: DatabaseService,
    private readonly permission: PermissionService,
    private readonly audit: AuditService,
  ) {}

  // ── Employee: create request ───────────────────────────────────────────────────

  async createRequest(
    user: RequestUser,
    dto: CreateProfileChangeRequest,
  ): Promise<{ id: string; status: string }> {
    // GATE: permission check before any DB work.
    await this.assertCan(user, "create", "profile-change-request");

    // Validate no forbidden fields are in changedFields (HR-ERR-040).
    const forbidden = (dto.changedFields as string[]).filter((f) => FORBIDDEN_FIELDS.has(f));
    if (forbidden.length > 0) {
      throw new BadRequestException(
        `HR-ERR-040: Fields not allowed for self-update: ${forbidden.join(", ")}`,
      );
    }

    return this.db.withTenant(user.companyId, async (tx) => {
      // Resolve employee profile for the current user (Own scope).
      const emp = await this.repo.findEmployeeByUserIdTx(tx, user.companyId, user.id);
      if (!emp) {
        throw new NotFoundException("No employee profile linked to your account. Contact HR.");
      }

      // Build old_values snapshot from current employee data for the changed fields.
      const empRecord = emp as unknown as Record<string, unknown>;
      const oldValues: Record<string, unknown> = {};
      for (const field of dto.changedFields) {
        // Map allowed field names to the current employee_profiles column value.
        // Fields not yet in the schema return undefined → stored as null.
        const colKey = fieldToColumnKey(field);
        oldValues[field] = colKey ? (empRecord[colKey] ?? null) : null;
      }

      // Guard: detect if newValues is actually different from current data (HR-ERR-041).
      const hasRealChange = dto.changedFields.some(
        (f) => String(dto.newValues[f] ?? "") !== String(oldValues[f] ?? ""),
      );
      if (!hasRealChange) {
        throw new BadRequestException(
          "HR-ERR-041: No actual change detected — new values are identical to current data.",
        );
      }

      // Restrict newValues to only the changedFields keys (strip extras).
      const sanitizedNew: Record<string, unknown> = {};
      for (const f of dto.changedFields) {
        sanitizedNew[f] = dto.newValues[f] ?? null;
      }

      const req = await this.repo.createRequestTx(tx, user.companyId, {
        employeeId: emp.id,
        requestedBy: user.id,
        oldValues,
        newValues: sanitizedNew,
        changedFields: [...dto.changedFields],
        reason: dto.reason ?? null,
      });

      // Audit: create event (BẤT BIẾN #2 — inside same tx).
      await this.audit.record(tx, {
        action: "create",
        objectType: "profile_change_request",
        objectId: req.id,
        actorUserId: user.id,
        moduleCode: "HR",
        actionGroup: "ProfileChangeRequest",
        resultStatus: "Success",
        // BẤT BIẾN #3: masker handles identity_number → "***"
        newValues: sanitizedNew,
      });

      return { id: req.id, status: req.status };
    });
  }

  // ── HR: list all requests (Company scope) ─────────────────────────────────────

  async listRequests(
    user: RequestUser,
    query: ProfileChangeRequestListQuery,
  ): Promise<ProfileChangeRequestListResponse> {
    await this.assertCan(user, "approve", "profile-change-request");

    return this.db.withTenant(user.companyId, async (tx) => {
      const { rows, total } = await this.repo.listRequestsTx(tx, user.companyId, {
        page: query.page,
        pageSize: query.pageSize,
        status: query.status,
        employeeId: query.employeeId,
      });

      const items = rows.map((r) => this.toListItem(r as unknown as PcrDetailRow));
      return this.buildListResponse(items, total, query.page, query.pageSize);
    });
  }

  // ── Employee: list own requests ────────────────────────────────────────────────

  async listOwnRequests(
    user: RequestUser,
    query: Omit<ProfileChangeRequestListQuery, "employeeId">,
  ): Promise<ProfileChangeRequestListResponse> {
    await this.assertCan(user, "create", "profile-change-request");

    return this.db.withTenant(user.companyId, async (tx) => {
      const emp = await this.repo.findEmployeeByUserIdTx(tx, user.companyId, user.id);
      if (!emp) {
        // No profile → return empty list (not an error for GET /me route).
        return this.buildListResponse([], 0, query.page, query.pageSize);
      }

      const { rows, total } = await this.repo.listOwnRequestsTx(tx, user.companyId, emp.id, {
        page: query.page,
        pageSize: query.pageSize,
        status: query.status,
      });

      const items = rows.map((r) => this.toListItem(r as unknown as PcrDetailRow));
      return this.buildListResponse(items, total, query.page, query.pageSize);
    });
  }

  // ── Shared: get detail (employee Own or HR Company) ───────────────────────────

  async getRequestDetail(user: RequestUser, id: string): Promise<ProfileChangeRequestDetail> {
    return this.db.withTenant(user.companyId, async (tx) => {
      const req = await this.repo.findRequestByIdTx(tx, user.companyId, id);
      if (!req) throw new NotFoundException("Profile change request not found");

      // Own-scope enforcement (SPEC-03 §14.20):
      // The caller must be the employee who submitted this request.
      // We look up their employee profile and verify the profile id matches req.employeeId.
      // This is tenant-safe: the repo call is already scoped to companyId.
      // HR detail access is out-of-scope for this endpoint; HR uses GET /hr/profile-change-requests
      // (list with filters) to find specific requests, then approves/rejects by id.
      const emp = await this.repo.findEmployeeByUserIdTx(tx, user.companyId, user.id);
      if (!emp || emp.id !== req.employeeId) {
        throw new NotFoundException("Profile change request not found");
      }

      const reviewedByName = req.reviewedBy
        ? await this.repo.findUserNameTx(tx, user.companyId, req.reviewedBy)
        : null;

      return this.toDetail(req, reviewedByName);
    });
  }

  // ── HR: approve request → apply changes to employee ──────────────────────────

  async approveRequest(
    user: RequestUser,
    id: string,
    dto: ApproveProfileChangeRequest,
  ): Promise<{ id: string; status: string }> {
    await this.assertCan(user, "approve", "profile-change-request");

    return this.db.withTenant(user.companyId, async (tx) => {
      const req = await this.repo.findRequestByIdTx(tx, user.companyId, id);
      if (!req) throw new NotFoundException("Profile change request not found");
      if (req.status !== "Pending") {
        throw new ConflictException(
          `Cannot approve a request with status '${req.status}' — only Pending requests can be approved.`,
        );
      }

      // Apply newValues to employee_profiles (only allowed mapped columns).
      await this.repo.applyChangesToEmployeeTx(tx, user.companyId, req.employeeId, req.newValues);

      // Advance state machine → Approved.
      const updated = await this.repo.updateRequestStatusTx(tx, user.companyId, id, {
        status: "Approved",
        reviewedBy: user.id,
      });

      // Audit: approve event — BẤT BIẾN #2 (same tx). BẤT BIẾN #3 (masker handles PII).
      await this.audit.record(tx, {
        action: "approve",
        objectType: "profile_change_request",
        objectId: id,
        actorUserId: user.id,
        moduleCode: "HR",
        actionGroup: "ProfileChangeRequest",
        resultStatus: "Success",
        oldValues: req.oldValues,
        newValues: req.newValues,
      });

      return { id: updated.id, status: updated.status };
    });
  }

  // ── HR: reject request ─────────────────────────────────────────────────────────

  async rejectRequest(
    user: RequestUser,
    id: string,
    dto: RejectProfileChangeRequest,
  ): Promise<{ id: string; status: string }> {
    await this.assertCan(user, "approve", "profile-change-request");

    // Validate rejection reason present (HR-ERR-042).
    if (!dto.rejectionReason?.trim()) {
      throw new BadRequestException("HR-ERR-042: Rejection reason is required.");
    }

    return this.db.withTenant(user.companyId, async (tx) => {
      const req = await this.repo.findRequestByIdTx(tx, user.companyId, id);
      if (!req) throw new NotFoundException("Profile change request not found");
      if (req.status !== "Pending") {
        throw new ConflictException(
          `Cannot reject a request with status '${req.status}' — only Pending requests can be rejected.`,
        );
      }

      // Advance state machine → Rejected (employee record unchanged).
      const updated = await this.repo.updateRequestStatusTx(tx, user.companyId, id, {
        status: "Rejected",
        reviewedBy: user.id,
        rejectionReason: dto.rejectionReason,
      });

      // Audit: reject event — BẤT BIẾN #2 (same tx).
      await this.audit.record(tx, {
        action: "reject",
        objectType: "profile_change_request",
        objectId: id,
        actorUserId: user.id,
        moduleCode: "HR",
        actionGroup: "ProfileChangeRequest",
        resultStatus: "Denied",
        metadata: { rejectionReason: dto.rejectionReason },
      });

      return { id: updated.id, status: updated.status };
    });
  }

  // ── Employee: cancel own pending request ──────────────────────────────────────

  async cancelRequest(user: RequestUser, id: string): Promise<{ id: string; status: string }> {
    return this.db.withTenant(user.companyId, async (tx) => {
      // Resolve own employee profile (Own-scope).
      const emp = await this.repo.findEmployeeByUserIdTx(tx, user.companyId, user.id);
      const req = await this.repo.findRequestByIdTx(tx, user.companyId, id);
      if (!req) throw new NotFoundException("Profile change request not found");

      // Own-scope: employee may only cancel their own request.
      if (!emp || emp.id !== req.employeeId) {
        throw new ForbiddenException("You may only cancel your own profile change requests.");
      }

      if (req.status !== "Pending") {
        throw new ConflictException(
          `Cannot cancel a request with status '${req.status}' — only Pending requests can be cancelled.`,
        );
      }

      const now = new Date();
      const updated = await this.repo.updateRequestStatusTx(tx, user.companyId, id, {
        status: "Cancelled",
        cancelledAt: now,
      });

      // Audit: cancel event — BẤT BIẾN #2 (same tx).
      await this.audit.record(tx, {
        action: "cancel",
        objectType: "profile_change_request",
        objectId: id,
        actorUserId: user.id,
        moduleCode: "HR",
        actionGroup: "ProfileChangeRequest",
        resultStatus: "Success",
      });

      return { id: updated.id, status: updated.status };
    });
  }

  // ── Projection helpers ────────────────────────────────────────────────────────

  private toListItem(row: PcrDetailRow): ProfileChangeRequestListItem {
    return {
      id: row.id,
      employeeId: row.employeeId,
      employeeCode: row.employeeCode ?? null,
      employeeFullName: "", // enriched via JOIN in real query; placeholder for unit test
      status: row.status as ProfileChangeRequestListItem["status"],
      changedFields: Array.isArray(row.changedFields) ? row.changedFields : [],
      reason: row.reason ?? null,
      submittedAt: row.submittedAt.toISOString(),
      reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
      reviewedByName: null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private toDetail(row: PcrDetailRow, reviewedByName: string | null): ProfileChangeRequestDetail {
    return {
      id: row.id,
      employeeId: row.employeeId,
      employeeCode: row.employeeCode ?? null,
      employeeFullName: "",
      requestedBy: row.requestedBy,
      status: row.status as ProfileChangeRequestDetail["status"],
      changedFields: Array.isArray(row.changedFields) ? row.changedFields : [],
      oldValues: row.oldValues,
      newValues: row.newValues,
      reason: row.reason ?? null,
      rejectionReason: row.rejectionReason ?? null,
      reviewedBy: row.reviewedBy ?? null,
      reviewedByName,
      reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
      submittedAt: row.submittedAt.toISOString(),
      cancelledAt: row.cancelledAt ? row.cancelledAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private buildListResponse(
    items: ProfileChangeRequestListItem[],
    total: number,
    page: number,
    pageSize: number,
  ): ProfileChangeRequestListResponse {
    const totalPages = pageSize > 0 ? Math.ceil(total / pageSize) : 0;
    return {
      items,
      meta: { page, pageSize, total, totalPages, hasNext: page < totalPages, hasPrev: page > 1 },
    };
  }

  // ── Permission helpers ────────────────────────────────────────────────────────

  private async assertCan(user: RequestUser, action: string, resourceType: string): Promise<void> {
    const decision = await this.permission.can({
      userId: user.id,
      companyId: user.companyId,
      action,
      resourceType,
    });
    if (!decision.allow) {
      throw new ForbiddenException(
        `Permission denied: ${decision.reason ?? `${action}:${resourceType}`}`,
      );
    }
  }
}

// ── Field name → employee_profiles column key mapping ────────────────────────────

/**
 * Maps SPEC-03 allowed field names to the current Drizzle column keys on employeeProfiles.
 * Returns null for fields whose columns do not yet exist in the schema
 * (they will be added in S2-HR-DB-2 migration lane).
 */
function fieldToColumnKey(field: string): string | null {
  const MAP: Record<string, string> = {
    phone: "phone",
    avatar_file_id: "avatarUrl",
    notes: "notes",
    // Fields below need S2-HR-DB-2 migration to add columns to employee_profiles:
    // date_of_birth, gender, marital_status, personal_email, current_address,
    // permanent_address, emergency_contact_name, emergency_contact_phone,
    // identity_number, identity_issue_date, identity_issue_place
  };
  return MAP[field] ?? null;
}
