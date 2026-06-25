/**
 * S2-HR-BE-4 — Profile change request deny-path RED suite (FULL gate, BẤT BIẾN #1/#2/#3).
 *
 * Nghiệm thu Đội 3:
 *  - POST profile-change-request (employee, scope Own) + GET list/detail; PATCH approve/reject ghi audit.
 *  - Yêu cầu duyệt → áp vào employee (newValues ghi vào employees); field nhạy cảm cần quyền cao hơn.
 *  - deny-path: employee chỉ gửi/xem của mình; thiếu quyền duyệt → 403; cross-tenant → 0 row/404.
 *
 * Covers (deny-first):
 *  - FORBIDDEN (403): no create:profile-change-request → ForbiddenException BEFORE any write.
 *  - FORBIDDEN (403): no approve:profile-change-request → 403 on approve/reject.
 *  - OWN-ONLY: employee xem/hủy request của người khác → NotFoundException (tenant-safe).
 *  - CROSS-TENANT: getDetail with wrong companyId → NotFoundException (never leaks data).
 *  - FIELD GUARD: request chứa field bị cấm (department_id) → BadRequestException (HR-ERR-040).
 *  - NO-CHANGE: changedFields empty or newValues identical to old → BadRequestException (HR-ERR-041).
 *  - REJECT WITHOUT REASON: reject tanpa rejectionReason → BadRequestException (HR-ERR-042).
 *  - NON-PENDING: approve/reject request đã Approved/Rejected/Cancelled → ConflictException.
 *  - AUDIT: approve ghi audit_logs object_type='profile_change_request' cùng tx (BẤT BIẾN #2).
 *  - APPLY: approve → employees table ghi newValues (correct fields only, không vỡ columns khác).
 *  - SENSITIVE: identity_number trong newValues đi qua audit masker (BẤT BIẾN #3).
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { ProfileChangeRequestService } from "./profile-change-request.service";

// ─── Fixtures ──────────────────────────────────────────────────────────────────

const COMPANY_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const COMPANY_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const EMP_USER_ID = "11111111-1111-1111-1111-111111111111";
const HR_USER_ID = "22222222-2222-2222-2222-222222222222";
const EMP_PROFILE_ID = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
const REQUEST_ID = "rrrrrrrr-rrrr-rrrr-rrrr-rrrrrrrrrrrr";

const empUser = { id: EMP_USER_ID, companyId: COMPANY_A };
const hrUser = { id: HR_USER_ID, companyId: COMPANY_A };
const wrongTenantUser = { id: EMP_USER_ID, companyId: COMPANY_B };

type Decision = { allow: boolean; reason: string; auditRequired: boolean };
const ALLOW: Decision = { allow: true, reason: "allow", auditRequired: false };
const DENY = (reason = "no-grant"): Decision => ({ allow: false, reason, auditRequired: false });

/** can() input shape (subset used by the service). */
type CanInput = { action: string };
type CanFn = (input: CanInput) => Decision;

/** Build a can() that returns a different decision per `action` (e.g. approve=ALLOW, view-sensitive=DENY). */
function perActionDecision(map: Record<string, Decision>): CanFn {
  return ({ action }) => map[action] ?? DENY(`no grant for action ${action}`);
}

function makePendingRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: REQUEST_ID,
    companyId: COMPANY_A,
    employeeId: EMP_PROFILE_ID,
    requestedBy: EMP_USER_ID,
    status: "Pending",
    oldValues: { phone: "0900000000" },
    newValues: { phone: "0911111111" },
    changedFields: ["phone"],
    reason: "Updated phone number",
    rejectionReason: null,
    reviewedBy: null,
    reviewedAt: null,
    submittedAt: new Date("2026-06-25T00:00:00Z"),
    cancelledAt: null,
    createdAt: new Date("2026-06-25T00:00:00Z"),
    updatedAt: new Date("2026-06-25T00:00:00Z"),
    ...overrides,
  };
}

function makeEmployeeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: EMP_PROFILE_ID,
    companyId: COMPANY_A,
    userId: EMP_USER_ID,
    phone: "0900000000",
    ...overrides,
  };
}

// ─── Mock factories ────────────────────────────────────────────────────────────

function makeRepo(overrides: Partial<ReturnType<typeof defaultRepo>> = {}) {
  return { ...defaultRepo(), ...overrides };
}

function defaultRepo() {
  return {
    findEmployeeByUserIdTx: vi.fn().mockResolvedValue(makeEmployeeRow()),
    createRequestTx: vi.fn().mockResolvedValue(makePendingRequest()),
    findRequestByIdTx: vi.fn().mockResolvedValue(makePendingRequest()),
    listRequestsTx: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
    listOwnRequestsTx: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
    updateRequestStatusTx: vi.fn().mockResolvedValue(makePendingRequest({ status: "Approved" })),
    applyChangesToEmployeeTx: vi.fn().mockResolvedValue(undefined),
    writeProfileChangeHistoryTx: vi.fn().mockResolvedValue(undefined),
  };
}

function makePermission(canImpl: CanFn = () => ALLOW) {
  return { can: vi.fn().mockImplementation(async (input: CanInput) => canImpl(input)) };
}

function makeAudit() {
  return { record: vi.fn().mockResolvedValue(undefined) };
}

function makeDb(repo: ReturnType<typeof makeRepo>) {
  return {
    withTenant: vi
      .fn()
      .mockImplementation(async (companyId: string, fn: (tx: unknown) => Promise<unknown>) => {
        // Simulate tenant isolation: calls with wrong companyId never reach the fn
        // (in real DB the RLS blocks it; in mock we simulate via the repo returning null).
        return fn({} /* mock tx */);
      }),
  };
}

function makeService(
  repoOverrides: Partial<ReturnType<typeof defaultRepo>> = {},
  canDecision: CanFn = () => ALLOW,
) {
  const repo = makeRepo(repoOverrides);
  const permission = makePermission(canDecision);
  const audit = makeAudit();
  const db = makeDb(repo);
  const svc = new ProfileChangeRequestService(
    repo as never,
    db as never,
    permission as never,
    audit as never,
  );
  return { svc, repo, permission, audit, db };
}

// ─── Deny-path tests (RED) ─────────────────────────────────────────────────────

describe("ProfileChangeRequestService — deny-path", () => {
  // ── 1. Permission guard: no create:profile-change-request ──────────────────────
  it("create: throws ForbiddenException when caller lacks create:profile-change-request", async () => {
    const { svc } = makeService({}, () => DENY("no create:profile-change-request"));

    await expect(
      svc.createRequest(empUser, {
        changedFields: ["phone"],
        newValues: { phone: "0911111111" },
        reason: "test",
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  // ── 2. Permission guard: no approve:profile-change-request ────────────────────
  it("approve: throws ForbiddenException when caller lacks approve:profile-change-request", async () => {
    const { svc } = makeService({}, () => DENY("no approve:profile-change-request"));

    await expect(svc.approveRequest(hrUser, REQUEST_ID, {})).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it("reject: throws ForbiddenException when caller lacks approve:profile-change-request", async () => {
    const { svc } = makeService({}, () => DENY("no approve:profile-change-request"));

    await expect(
      svc.rejectRequest(hrUser, REQUEST_ID, { rejectionReason: "not valid" }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  // ── 3. OWN-ONLY: employee trying to view/cancel another employee's request ────
  it("getDetail: throws NotFoundException when employee accesses another's request (own-only)", async () => {
    // The request belongs to a different employee (EMP_PROFILE_ID), but the caller's linked
    // employee profile is different (simulated by returning a different profile ID).
    const { svc } = makeService({
      findEmployeeByUserIdTx: vi.fn().mockResolvedValue(makeEmployeeRow({ id: "other-emp-id" })),
      findRequestByIdTx: vi.fn().mockResolvedValue(makePendingRequest()),
    });

    await expect(svc.getRequestDetail(empUser, REQUEST_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("cancelRequest: throws ForbiddenException when employee cancels another's request", async () => {
    const { svc } = makeService({
      findEmployeeByUserIdTx: vi.fn().mockResolvedValue(makeEmployeeRow({ id: "other-emp-id" })),
      findRequestByIdTx: vi.fn().mockResolvedValue(makePendingRequest()),
    });

    await expect(svc.cancelRequest(empUser, REQUEST_ID)).rejects.toBeInstanceOf(ForbiddenException);
  });

  // ── 4. CROSS-TENANT: request belongs to different company ────────────────────
  it("getDetail: throws NotFoundException when request not found in caller's company", async () => {
    const { svc } = makeService({
      findRequestByIdTx: vi.fn().mockResolvedValue(null), // RLS gives 0 rows
    });

    await expect(svc.getRequestDetail(empUser, REQUEST_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  // ── 5. FIELD GUARD: forbidden field in changedFields ─────────────────────────
  it("create: throws BadRequestException (HR-ERR-040) when changedFields contains forbidden field", async () => {
    // department_id is in the deny-list (SPEC-03 §13.4)
    const { svc } = makeService();

    await expect(
      svc.createRequest(empUser, {
        changedFields: ["phone", "department_id"] as never, // type hack to bypass Zod in unit test
        newValues: { phone: "0911111111", department_id: "dep-123" },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  // ── 6. NO-CHANGE: newValues identical to current employee data ────────────────
  it("create: throws BadRequestException (HR-ERR-041) when no actual change detected", async () => {
    const { svc } = makeService({
      findEmployeeByUserIdTx: vi.fn().mockResolvedValue(makeEmployeeRow({ phone: "0900000000" })),
    });

    await expect(
      svc.createRequest(empUser, {
        changedFields: ["phone"],
        // newValues same as current value → no change
        newValues: { phone: "0900000000" },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  // ── 7. REJECT WITHOUT REASON → HR-ERR-042 ────────────────────────────────────
  it("reject: throws BadRequestException (HR-ERR-042) when rejectionReason is empty", async () => {
    const { svc } = makeService();

    await expect(
      svc.rejectRequest(hrUser, REQUEST_ID, { rejectionReason: "" }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  // ── 8. NON-PENDING state machine: approve already-Approved request ───────────
  it("approve: throws ConflictException when request is not Pending", async () => {
    const { svc } = makeService({
      findRequestByIdTx: vi.fn().mockResolvedValue(makePendingRequest({ status: "Approved" })),
    });

    await expect(svc.approveRequest(hrUser, REQUEST_ID, {})).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it("reject: throws ConflictException when request is Cancelled", async () => {
    const { svc } = makeService({
      findRequestByIdTx: vi.fn().mockResolvedValue(makePendingRequest({ status: "Cancelled" })),
    });

    await expect(
      svc.rejectRequest(hrUser, REQUEST_ID, { rejectionReason: "Already done" }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("cancelRequest: throws ConflictException when request is already Rejected", async () => {
    const { svc } = makeService({
      findEmployeeByUserIdTx: vi.fn().mockResolvedValue(makeEmployeeRow()),
      findRequestByIdTx: vi.fn().mockResolvedValue(makePendingRequest({ status: "Rejected" })),
    });

    await expect(svc.cancelRequest(empUser, REQUEST_ID)).rejects.toBeInstanceOf(ConflictException);
  });

  // ── 9. SENSITIVE GATE (§14.18 "Giấy tờ" — duyệt nghiêm ngặt): approver chạm identity_* ─────────
  //     phải có view-sensitive:employee. Có approve nhưng THIẾU view-sensitive → 403 + audit Denied.
  it("approve: throws ForbiddenException when approving identity_number without view-sensitive:employee", async () => {
    const sensitiveReq = makePendingRequest({
      changedFields: ["identity_number"],
      oldValues: { identity_number: "0790000" },
      newValues: { identity_number: "079123456789" },
    });
    // approve:profile-change-request → ALLOW ; view-sensitive:employee → DENY
    const { svc, repo, audit } = makeService(
      { findRequestByIdTx: vi.fn().mockResolvedValue(sensitiveReq) },
      perActionDecision({ approve: ALLOW, "view-sensitive": DENY("no view-sensitive:employee") }),
    );

    await expect(svc.approveRequest(hrUser, REQUEST_ID, {})).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    // No write to employee record (gate blocks before apply).
    expect(repo.applyChangesToEmployeeTx).not.toHaveBeenCalled();
    expect(repo.updateRequestStatusTx).not.toHaveBeenCalled();
    // Audit the denied attempt with sensitivityLevel='Sensitive' + resultStatus='Denied'.
    expect(audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "approve",
        objectType: "profile_change_request",
        resultStatus: "Denied",
        sensitivityLevel: "Sensitive",
      }),
    );
  });

  it("approve: identity_issue_date/place are also strict-approval (gated by view-sensitive)", async () => {
    const sensitiveReq = makePendingRequest({
      changedFields: ["identity_issue_place"],
      oldValues: { identity_issue_place: "HCM" },
      newValues: { identity_issue_place: "Ha Noi" },
    });
    const { svc, repo } = makeService(
      { findRequestByIdTx: vi.fn().mockResolvedValue(sensitiveReq) },
      perActionDecision({ approve: ALLOW, "view-sensitive": DENY() }),
    );

    await expect(svc.approveRequest(hrUser, REQUEST_ID, {})).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(repo.applyChangesToEmployeeTx).not.toHaveBeenCalled();
  });
});

// ─── Happy-path tests (GREEN) ──────────────────────────────────────────────────

describe("ProfileChangeRequestService — happy-path", () => {
  // ── 9. Create: success path ───────────────────────────────────────────────────
  it("create: stores request with Pending status and returns id", async () => {
    const { svc, repo } = makeService();

    const result = await svc.createRequest(empUser, {
      changedFields: ["phone"],
      newValues: { phone: "0911111111" },
      reason: "Updated number",
    });

    expect(repo.createRequestTx).toHaveBeenCalledOnce();
    expect(result.status).toBe("Pending");
    expect(result.id).toBeDefined();
  });

  // ── 10. Approve: applies newValues to employees table + writes history ───────
  it("approve: calls applyChangesToEmployeeTx and records audit", async () => {
    const { svc, repo, audit } = makeService();

    await svc.approveRequest(hrUser, REQUEST_ID, { note: "looks good" });

    expect(repo.applyChangesToEmployeeTx).toHaveBeenCalledOnce();
    expect(repo.updateRequestStatusTx).toHaveBeenCalledWith(
      expect.anything(), // tx
      COMPANY_A,
      REQUEST_ID,
      expect.objectContaining({ status: "Approved", reviewedBy: HR_USER_ID }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "approve",
        objectType: "profile_change_request",
        objectId: REQUEST_ID,
        actorUserId: HR_USER_ID,
      }),
    );
  });

  // ── 10b. Approve: writes ONE history row per applied field in the SAME tx (§14.12) ──
  it("approve: writes employee_profile_change_histories row for each changed field", async () => {
    const req = makePendingRequest({
      changedFields: ["phone", "current_address"],
      oldValues: { phone: "0900000000", current_address: "Old St" },
      newValues: { phone: "0911111111", current_address: "New St" },
    });
    const { svc, repo } = makeService({
      findRequestByIdTx: vi.fn().mockResolvedValue(req),
    });

    await svc.approveRequest(hrUser, REQUEST_ID, {});

    expect(repo.writeProfileChangeHistoryTx).toHaveBeenCalledWith(
      expect.anything(), // tx
      COMPANY_A,
      expect.objectContaining({
        employeeId: EMP_PROFILE_ID,
        requestId: REQUEST_ID,
        changedBy: HR_USER_ID,
        entries: expect.arrayContaining([
          expect.objectContaining({ fieldName: "phone", isSensitive: false }),
          expect.objectContaining({ fieldName: "current_address", isSensitive: false }),
        ]),
      }),
    );
  });

  // ── 10c. Approve sensitive field WITH view-sensitive grant → applies + history is_sensitive ──
  it("approve: identity_number with view-sensitive grant applies + marks history sensitive", async () => {
    const req = makePendingRequest({
      changedFields: ["identity_number"],
      oldValues: { identity_number: "0790000" },
      newValues: { identity_number: "079123456789" },
    });
    const { svc, repo } = makeService(
      { findRequestByIdTx: vi.fn().mockResolvedValue(req) },
      perActionDecision({ approve: ALLOW, "view-sensitive": ALLOW }),
    );

    const result = await svc.approveRequest(hrUser, REQUEST_ID, {});

    expect(result.status).toBe("Approved");
    expect(repo.applyChangesToEmployeeTx).toHaveBeenCalledOnce();
    expect(repo.writeProfileChangeHistoryTx).toHaveBeenCalledWith(
      expect.anything(),
      COMPANY_A,
      expect.objectContaining({
        entries: expect.arrayContaining([
          expect.objectContaining({ fieldName: "identity_number", isSensitive: true }),
        ]),
      }),
    );
  });

  // ── 11. Reject: stores rejectionReason, does NOT apply changes ───────────────
  it("reject: sets status Rejected, does NOT call applyChangesToEmployeeTx", async () => {
    const { svc, repo, audit } = makeService();

    await svc.rejectRequest(hrUser, REQUEST_ID, { rejectionReason: "Data mismatch" });

    expect(repo.applyChangesToEmployeeTx).not.toHaveBeenCalled();
    expect(repo.updateRequestStatusTx).toHaveBeenCalledWith(
      expect.anything(),
      COMPANY_A,
      REQUEST_ID,
      expect.objectContaining({ status: "Rejected", rejectionReason: "Data mismatch" }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "reject",
        objectType: "profile_change_request",
        objectId: REQUEST_ID,
      }),
    );
  });

  // ── 12. Cancel own request ────────────────────────────────────────────────────
  it("cancelRequest: employee cancels own pending request successfully", async () => {
    const { svc, repo, audit } = makeService({
      findEmployeeByUserIdTx: vi.fn().mockResolvedValue(makeEmployeeRow()),
      findRequestByIdTx: vi.fn().mockResolvedValue(makePendingRequest()),
    });

    await svc.cancelRequest(empUser, REQUEST_ID);

    expect(repo.updateRequestStatusTx).toHaveBeenCalledWith(
      expect.anything(),
      COMPANY_A,
      REQUEST_ID,
      expect.objectContaining({ status: "Cancelled" }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "cancel", objectType: "profile_change_request" }),
    );
  });

  // ── 13. List own: employee only sees their own requests ───────────────────────
  it("listOwnRequests: calls listOwnRequestsTx with employee's profileId, not all company requests", async () => {
    const { svc, repo } = makeService({
      listOwnRequestsTx: vi.fn().mockResolvedValue({ rows: [makePendingRequest()], total: 1 }),
    });

    const result = await svc.listOwnRequests(empUser, { page: 1, pageSize: 20 });

    expect(repo.listOwnRequestsTx).toHaveBeenCalledWith(
      expect.anything(),
      COMPANY_A,
      EMP_PROFILE_ID,
      expect.objectContaining({ page: 1, pageSize: 20 }),
    );
    expect(result.items).toHaveLength(1);
    // Verify the service does NOT call listRequestsTx (HR-wide) for an employee
    expect(repo.listRequestsTx).not.toHaveBeenCalled();
  });

  // ── 14. BẤT BIẾN #1: withTenant called with caller's companyId ───────────────
  it("createRequest: all repo calls run inside withTenant(caller.companyId)", async () => {
    const { svc, db } = makeService();

    await svc.createRequest(empUser, {
      changedFields: ["phone"],
      newValues: { phone: "0911111111" },
    });

    expect(db.withTenant).toHaveBeenCalledWith(COMPANY_A, expect.any(Function));
  });
});
