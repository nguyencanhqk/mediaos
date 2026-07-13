import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  PROFILE_CHANGE_SENSITIVE_FIELDS,
  type ApproveProfileChangeRequest,
  type CreateProfileChangeRequest,
  type ProfileChangeRequestDetail,
  type ProfileChangeRequestListItem,
  type ProfileChangeRequestListQuery,
  type ProfileChangeRequestListResponse,
  type RejectProfileChangeRequest,
} from "@mediaos/contracts";
import { AuditService } from "../events/audit.service";
import { AuditMaskerService } from "../events/audit-masker.service";
import { DatabaseService } from "../db/db.service";
import { PermissionService } from "../permission/permission.service";
import {
  FIELD_TO_COLUMN,
  // NOT a type-only import: ProfileChangeRequestRepository is an @Injectable class injected at
  // constructor index [0]. A `type` import erases the runtime paramtype metadata → Nest DI resolves
  // it to undefined ("dependency at index [0] appears to be undefined at runtime"). Keep it a value.
  ProfileChangeRequestRepository,
  type ProfileChangeHistoryEntry,
  type PcrDetailRow,
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
 * Nhóm "Giấy tờ" (SPEC-03 §14.18 — "Có, cần duyệt nghiêm ngặt"). Khi yêu cầu duyệt chạm bất kỳ
 * field nào trong tập này, người DUYỆT phải có thêm quyền cao hơn `view-sensitive:employee`
 * (seed mig 0444 — KHÔNG seed mới). Một nguồn sự thật từ contracts.
 */
const SENSITIVE_FIELDS = new Set<string>(PROFILE_CHANGE_SENSITIVE_FIELDS);

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
  /** BẤT BIẾN #3: mask giá trị nhạy cảm (identity_number…) TRƯỚC khi ghi history append-only. */
  private readonly masker: AuditMaskerService;

  constructor(
    private readonly repo: ProfileChangeRequestRepository,
    private readonly db: DatabaseService,
    private readonly permission: PermissionService,
    private readonly audit: AuditService,
    masker?: AuditMaskerService,
  ) {
    // masker optional ở chữ ký để KHÔNG vỡ call-site `new ProfileChangeRequestService(...)` trong unit
    // test. Nest DI luôn truyền AuditMaskerService thật (EventsModule @Global); thiếu → default cùng hàm.
    this.masker = masker ?? new AuditMaskerService();
  }

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
    _dto: ApproveProfileChangeRequest,
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

      const fields = Array.isArray(req.changedFields) ? req.changedFields : [];
      const touchesSensitive = fields.some((f) => SENSITIVE_FIELDS.has(f));

      // SENSITIVE GATE (SPEC-03 §14.18 "Giấy tờ — cần duyệt nghiêm ngặt"): an approver may hold
      // approve:profile-change-request without the identity grant. If the request touches an identity
      // field, require the stronger grant. HR-IDENTITY-READ-1: this is now the SAME gate as the read
      // surface — view-identity:employee (mig 0494, is_sensitive), NOT the broader view-sensitive PII
      // gate — so the write (approve) and the read of identity share ONE permission. isSensitive:true →
      // a wildcard *:* never satisfies it. Fail-closed → 403 + audit Denied/Sensitive.
      if (touchesSensitive) {
        const decision = await this.permission.can({
          userId: user.id,
          companyId: user.companyId,
          action: "view-identity",
          resourceType: "employee",
          isSensitive: true,
        });
        if (!decision.allow) {
          // BẤT BIẾN #2: audit the denial inside the same tx. BẤT BIẾN #3: masker handles PII.
          await this.audit.record(tx, {
            action: "approve",
            objectType: "profile_change_request",
            objectId: id,
            actorUserId: user.id,
            moduleCode: "HR",
            actionGroup: "ProfileChangeRequest",
            resultStatus: "Denied",
            sensitivityLevel: "Sensitive",
            permissionCode: "HR.EMPLOYEE.VIEW_IDENTITY",
            metadata: { changedFields: fields, reason: "missing view-identity:employee" },
          });
          throw new ForbiddenException(
            "Permission denied: approving identity/document fields requires HR.EMPLOYEE.VIEW_IDENTITY.",
          );
        }
      }

      // Apply newValues to employee_profiles (only allowed mapped columns — FIELD_TO_COLUMN).
      await this.repo.applyChangesToEmployeeTx(tx, user.companyId, req.employeeId, req.newValues);

      // Append field-level history rows (SPEC-03 §14.12) in the SAME tx — append-only (BẤT BIẾN #2).
      const entries = this.buildHistoryEntries(req);
      await this.repo.writeProfileChangeHistoryTx(tx, user.companyId, {
        employeeId: req.employeeId,
        requestId: id,
        changedBy: user.id,
        entries,
      });

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
        sensitivityLevel: touchesSensitive ? "Sensitive" : undefined,
        oldValues: req.oldValues,
        newValues: req.newValues,
      });

      return { id: updated.id, status: updated.status };
    });
  }

  /**
   * Build one history entry per applied field (fields with a real employee_profiles column).
   * BẤT BIẾN #3: sensitive values are masked (identity_number → "***") before being persisted
   * to the append-only history. is_sensitive marks the §14.18 "Giấy tờ" group.
   */
  private buildHistoryEntries(req: PcrDetailRow): ProfileChangeHistoryEntry[] {
    const fields = Array.isArray(req.changedFields) ? req.changedFields : [];
    const entries: ProfileChangeHistoryEntry[] = [];
    for (const field of fields) {
      // Only persist history for fields that actually map to an employee column.
      if (!FIELD_TO_COLUMN[field]) continue;
      const isSensitive = SENSITIVE_FIELDS.has(field);
      entries.push({
        fieldName: field,
        oldValue: this.maskFieldValue(field, req.oldValues?.[field] ?? null),
        newValue: this.maskFieldValue(field, req.newValues?.[field] ?? null),
        isSensitive,
      });
    }
    return entries;
  }

  /** Mask a single field value using the shared masker key rules (identity_number → "***"). */
  private maskFieldValue(field: string, value: unknown): unknown {
    const masked = this.masker.mask({ [field]: value }) as Record<string, unknown>;
    return masked[field];
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
 * Maps a SPEC-03 allowed field name to the Drizzle column key on employeeProfiles.
 * All 11 self-service fields now have real columns (mig 0451). Returns null for unknown keys.
 * Single source of truth = FIELD_TO_COLUMN in the repository (shared map).
 */
function fieldToColumnKey(field: string): string | null {
  return FIELD_TO_COLUMN[field] ?? null;
}
