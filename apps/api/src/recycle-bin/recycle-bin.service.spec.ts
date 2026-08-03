/**
 * CS-6 RecycleBinService unit tests (RED-GREEN TDD).
 *
 * Covers:
 *   - listDeletedEmployees: delegates to repo inside withTenant
 *   - restoreEmployee: updates row, writes audit, returns row
 *   - restoreEmployee: throws NotFoundException when row not found in recycle bin
 */

import { describe, expect, it, vi } from "vitest";
import { NotFoundException } from "@nestjs/common";
import { RecycleBinService } from "./recycle-bin.service";

// ─── Fixtures ──────────────────────────────────────────────────────────────────

const COMPANY_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const ACTOR_ID = "11111111-1111-1111-1111-111111111111";
const EMP_ID = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";

const actor = { id: ACTOR_ID, companyId: COMPANY_ID };

/** Hàng repo trả về SAU S6-SEC-IDENTITYBOUND-1: mang thêm cờ `identityInScope` do SQL quyết định. */
const deletedRow = {
  id: EMP_ID,
  userId: "22222222-2222-2222-2222-222222222222",
  employeeCode: "E-001",
  identityInScope: true,
  userFullName: "Nguyễn Văn A",
  userEmail: "nva@co.test",
  orgUnitId: null,
  orgUnitName: null,
  positionId: null,
  positionName: null,
  workType: "offline",
  employmentType: "full_time",
  status: "inactive",
  deletedAt: new Date("2026-06-01T00:00:00Z"),
};

// ─── Mock builders ──────────────────────────────────────────────────────────────

function makeRepo(overrides: Record<string, unknown> = {}) {
  return {
    listDeletedEmployeesTx: vi.fn().mockResolvedValue([deletedRow]),
    restoreEmployeeTx: vi.fn().mockResolvedValue({ id: EMP_ID }),
    ...overrides,
  };
}

function makeAudit() {
  return { record: vi.fn().mockResolvedValue(undefined) };
}

/**
 * withTenant executes the callback with a fake tx object and returns the result.
 * This mirrors the real DatabaseService.withTenant signature for unit tests.
 */
function makeDb() {
  const fakeTx = {};
  return {
    withTenant: vi
      .fn()
      .mockImplementation((_companyId: string, fn: (tx: unknown) => Promise<unknown>) =>
        fn(fakeTx),
      ),
  };
}

/**
 * S6-SEC-IDENTITYBOUND-1 — DataScopeService giả. Mặc định `Company` (đối chứng "thấy đủ"), test nào
 * cần ca hẹp thì override `resolveOrNull`.
 */
function makeDataScope(scope: string | null = "Company") {
  return {
    resolveOrNull: vi.fn().mockResolvedValue(scope),
    buildUserScopeCondition: vi.fn().mockReturnValue({ __predicate: scope }),
  };
}

/**
 * S7-CHAT-BE-5: stub `ChatDerivedRoomsSyncService`. Spec này kiểm luật của CHÍNH service đang test, không
 * kiểm đồng bộ phòng chat — hành vi thật của hook nằm ở `chat-be5-derived-rooms.int-spec.ts` (DB thật).
 */
function makeChatSync() {
  return {
    syncUserDerivedMembershipTx: vi.fn().mockResolvedValue(undefined),
    syncEmployeeDerivedMembershipTx: vi.fn().mockResolvedValue(undefined),
    tryEnsureOrgUnitRoom: vi.fn().mockResolvedValue(undefined),
    tryEnsureProjectRoom: vi.fn().mockResolvedValue(undefined),
    tryArchiveProjectRoom: vi.fn().mockResolvedValue(undefined),
    reportRevokeFailure: vi.fn().mockResolvedValue(undefined),
  };
}

function makeService(
  repoOverrides: Record<string, unknown> = {},
  scope: string | null = "Company",
) {
  const repo = makeRepo(repoOverrides);
  const db = makeDb();
  const audit = makeAudit();
  const dataScope = makeDataScope(scope);

  const svc = new RecycleBinService(
    repo as never,
    db as never,
    audit as never,
    dataScope as never,
    makeChatSync() as never,
  );
  return { svc, repo, db, audit, dataScope };
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("RecycleBinService — listDeletedEmployees", () => {
  it("delegates to repo.listDeletedEmployeesTx inside withTenant, KÈM vị từ danh tính", async () => {
    const { svc, repo, db, dataScope } = makeService();

    const result = await svc.listDeletedEmployees(actor);

    expect(db.withTenant).toHaveBeenCalledWith(COMPANY_ID, expect.any(Function));
    // S6-SEC-IDENTITYBOUND-1: repo PHẢI nhận vị từ scope làm tham số thứ 4 — chỗ mà trước WO này
    // không có gì cả (gate `read:employee` rồi chiếu email của MỌI hồ sơ đã xoá).
    expect(repo.listDeletedEmployeesTx).toHaveBeenCalledWith(
      expect.anything(),
      COMPANY_ID,
      expect.objectContaining({ __predicate: "Company" }),
    );
    // Scope resolve theo CẶP DANH BẠ (`view:user`), KHÔNG phải cặp gate (`read:employee`).
    expect(dataScope.resolveOrNull).toHaveBeenCalledWith(ACTOR_ID, COMPANY_ID, "view", "user");
    // Cờ nội bộ không được rò ra DTO.
    const { identityInScope: _flag, ...visible } = deletedRow;
    expect(result).toEqual([visible]);
  });

  // ── KI-051: ca cốt lõi — hình dạng role `employee` của PROD (45/46 user sống) ──────────────────
  it("KHÔNG có grant danh bạ (scope=null): giữ hàng nghiệp vụ, BỎ HẲN khoá danh tính", async () => {
    const { svc, repo, dataScope } = makeService(
      {
        listDeletedEmployeesTx: vi
          .fn()
          .mockResolvedValue([{ ...deletedRow, identityInScope: false }]),
      },
      null,
    );

    const result = await svc.listDeletedEmployees(actor);

    // `null` ⇒ truyền vị từ null xuống repo (repo tự khử bằng `sql`false``).
    expect(repo.listDeletedEmployeesTx).toHaveBeenCalledWith(expect.anything(), COMPANY_ID, null);
    expect(dataScope.buildUserScopeCondition).not.toHaveBeenCalled();
    // Vế nghiệp vụ còn nguyên — `read:employee` vẫn cho xem thùng rác.
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: EMP_ID, employeeCode: "E-001" });
    // Khoá phải VẮNG MẶT, không phải null.
    expect("userEmail" in (result[0] as object)).toBe(false);
    expect("userFullName" in (result[0] as object)).toBe(false);
    expect("identityInScope" in (result[0] as object)).toBe(false);
  });

  it("trộn trong-scope và ngoài-scope: chỉ hàng ngoài scope bị bỏ khoá", async () => {
    const outOfScope = {
      ...deletedRow,
      id: "ffffffff-ffff-ffff-ffff-ffffffffffff",
      identityInScope: false,
    };
    const { svc } = makeService({
      listDeletedEmployeesTx: vi.fn().mockResolvedValue([deletedRow, outOfScope]),
    });

    const result = await svc.listDeletedEmployees(actor);

    expect(result).toHaveLength(2);
    expect("userEmail" in (result[0] as object)).toBe(true);
    expect("userEmail" in (result[1] as object)).toBe(false);
  });

  it("returns empty array when no deleted employees", async () => {
    const { svc } = makeService({
      listDeletedEmployeesTx: vi.fn().mockResolvedValue([]),
    });

    const result = await svc.listDeletedEmployees(actor);
    expect(result).toEqual([]);
  });
});

describe("RecycleBinService — restoreEmployee", () => {
  it("calls restoreEmployeeTx + records audit inside withTenant", async () => {
    const { svc, repo, db, audit } = makeService();

    const result = await svc.restoreEmployee(actor, EMP_ID);

    expect(db.withTenant).toHaveBeenCalledWith(COMPANY_ID, expect.any(Function));
    expect(repo.restoreEmployeeTx).toHaveBeenCalledWith(expect.anything(), EMP_ID, COMPANY_ID);
    expect(audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "employee.restored",
        objectType: "employee",
        objectId: EMP_ID,
        actorUserId: ACTOR_ID,
      }),
    );
    expect(result).toEqual({ id: EMP_ID });
  });

  it("throws NotFoundException when employee is not in recycle bin", async () => {
    const { svc } = makeService({
      restoreEmployeeTx: vi.fn().mockResolvedValue(undefined),
    });

    await expect(svc.restoreEmployee(actor, EMP_ID)).rejects.toThrow(NotFoundException);
  });

  it("does NOT write audit when restore tx returns undefined (not-found rollback path)", async () => {
    const { svc, audit } = makeService({
      restoreEmployeeTx: vi.fn().mockResolvedValue(undefined),
    });

    await expect(svc.restoreEmployee(actor, EMP_ID)).rejects.toThrow();
    expect(audit.record).not.toHaveBeenCalled();
  });
});
