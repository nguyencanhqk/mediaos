/**
 * G5-FIX F3 — Breadth/happy-path suite for OrgService (org_units + teams + members).
 *
 * Phủ logic nghiệp vụ (mock repo): mapping field, default type, NotFound/Conflict/Internal,
 * PATCH team leader, soft-delete. Repository (DB-bound) phủ riêng bằng RLS integration registry.
 */
import {
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OrgService } from "./org.service";
import { ORG_EMPLOYEE_DIRECTORY } from "./org.permissions";

const COMPANY_ID = "22222222-2222-2222-2222-222222222222";
const UNIT_ID = "33333333-3333-3333-3333-333333333333";
const TEAM_ID = "44444444-4444-4444-4444-444444444444";
const USER_ID = "55555555-5555-5555-5555-555555555555";
const LEADER_ID = "66666666-6666-6666-6666-666666666666";

const PG_UNIQUE = { code: "23505" };

function makeRepo() {
  return {
    listOrgUnits: vi.fn().mockResolvedValue([{ id: UNIT_ID, name: "Eng" }]),
    getOrgTree: vi.fn().mockResolvedValue([
      {
        id: "div",
        name: "Division",
        children: [
          { id: "dep", name: "Dept", children: [{ id: "unit", name: "Unit", children: [] }] },
        ],
      },
    ]),
    createOrgUnit: vi.fn().mockResolvedValue([{ id: UNIT_ID, name: "Eng", type: "department" }]),
    updateOrgUnit: vi.fn().mockResolvedValue([{ id: UNIT_ID, status: "inactive" }]),
    softDeleteOrgUnit: vi.fn().mockResolvedValue([{ id: UNIT_ID }]),
    listTeams: vi.fn().mockResolvedValue([{ id: TEAM_ID, name: "Team A" }]),
    createTeam: vi
      .fn()
      .mockResolvedValue([{ id: TEAM_ID, name: "Team A", type: "production_team" }]),
    updateTeam: vi.fn().mockResolvedValue([{ id: TEAM_ID, leaderUserId: LEADER_ID }]),
    softDeleteTeam: vi.fn().mockResolvedValue([{ id: TEAM_ID }]),
    listTeamMembers: vi.fn().mockResolvedValue([{ id: "m1", userId: USER_ID }]),
    addTeamMember: vi.fn().mockResolvedValue([{ id: "m1", userId: USER_ID, roleName: "member" }]),
    removeTeamMember: vi.fn().mockResolvedValue([{ id: "m1" }]),
    listEmployees: vi.fn().mockResolvedValue([{ id: USER_ID, email: "a@x.test" }]),
  };
}

/**
 * S6-SEC-ORGSCOPE-1 — mock DataScopeService. `resolveAndAssert` trả `Company` mặc định để mọi ca cũ
 * giữ nguyên hành vi; ca scope riêng override trong từng test.
 */
function makeDataScope(scope: string | null = "Company") {
  return {
    resolveAndAssert: vi.fn().mockResolvedValue(scope),
    // S6-SEC-ORGTEAMSCOPE-1 (N-1c): bản KHÔNG ném, cho route mà cặp gate ≠ cặp bound dữ liệu.
    resolveOrNull: vi.fn().mockResolvedValue(scope),
    buildUserScopeCondition: vi.fn().mockReturnValue(SCOPE_COND),
  };
}

const SCOPE_COND = { __predicate: "scope-cond" } as never;
/** Actor tối thiểu cho đường đọc có scope (khớp `req.user`). */
const ACTOR = { id: USER_ID, companyId: COMPANY_ID };

function makeService(repo = makeRepo(), dataScope = makeDataScope()) {
  return { service: new OrgService(repo as never, dataScope as never), repo, dataScope };
}

describe("OrgService (F3 breadth)", () => {
  beforeEach(() => vi.clearAllMocks());

  // ── Org units ──────────────────────────────────────────────────────────────
  it("listOrgUnits forwards status filter", async () => {
    const { service, repo } = makeService();
    await service.listOrgUnits(COMPANY_ID, "active");
    expect(repo.listOrgUnits).toHaveBeenCalledWith(COMPANY_ID, "active");
  });

  it("getOrgTree returns 3-level tree", async () => {
    const { service } = makeService();
    const tree = await service.getOrgTree(COMPANY_ID);
    expect(tree[0].children[0].children[0].name).toBe("Unit");
  });

  it("createOrgUnit maps fields + returns row", async () => {
    const { service, repo } = makeService();
    const row = await service.createOrgUnit(COMPANY_ID, {
      name: "Eng",
      type: "department",
      parentId: UNIT_ID,
    });
    expect(row).toMatchObject({ id: UNIT_ID });
    expect(repo.createOrgUnit).toHaveBeenCalledWith(
      COMPANY_ID,
      expect.objectContaining({ name: "Eng", type: "department", parentId: UNIT_ID }),
    );
  });

  it("createOrgUnit → ConflictException on unique violation", async () => {
    const repo = makeRepo();
    repo.createOrgUnit.mockRejectedValueOnce(PG_UNIQUE);
    const { service } = makeService(repo);
    await expect(
      service.createOrgUnit(COMPANY_ID, { name: "Dup", type: "department" }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("createOrgUnit → InternalServerError when insert returns nothing", async () => {
    const repo = makeRepo();
    repo.createOrgUnit.mockResolvedValueOnce([]);
    const { service } = makeService(repo);
    await expect(
      service.createOrgUnit(COMPANY_ID, { name: "X", type: "department" }),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it("updateOrgUnit toggles status", async () => {
    const { service, repo } = makeService();
    const row = await service.updateOrgUnit(COMPANY_ID, UNIT_ID, { status: "inactive" });
    expect(row).toMatchObject({ status: "inactive" });
    expect(repo.updateOrgUnit).toHaveBeenCalledWith(
      COMPANY_ID,
      UNIT_ID,
      expect.objectContaining({ status: "inactive" }),
    );
  });

  it("updateOrgUnit → NotFound when missing", async () => {
    const repo = makeRepo();
    repo.updateOrgUnit.mockResolvedValueOnce([]);
    const { service } = makeService(repo);
    await expect(service.updateOrgUnit(COMPANY_ID, UNIT_ID, { name: "X" })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("updateOrgUnit → Conflict on unique violation", async () => {
    const repo = makeRepo();
    repo.updateOrgUnit.mockRejectedValueOnce(PG_UNIQUE);
    const { service } = makeService(repo);
    await expect(
      service.updateOrgUnit(COMPANY_ID, UNIT_ID, { code: "DUP" }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("deleteOrgUnit resolves when a row was soft-deleted", async () => {
    const { service, repo } = makeService();
    await expect(service.deleteOrgUnit(COMPANY_ID, UNIT_ID)).resolves.toBeUndefined();
    expect(repo.softDeleteOrgUnit).toHaveBeenCalledWith(COMPANY_ID, UNIT_ID);
  });

  it("deleteOrgUnit → NotFound when nothing deleted", async () => {
    const repo = makeRepo();
    repo.softDeleteOrgUnit.mockResolvedValueOnce([]);
    const { service } = makeService(repo);
    await expect(service.deleteOrgUnit(COMPANY_ID, UNIT_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  // ── Teams ──────────────────────────────────────────────────────────────────
  it("listTeams forwards status filter KÈM vị từ danh tính (N-1e, KI-052)", async () => {
    const { service, repo, dataScope } = makeService();
    await service.listTeams(ACTOR, "active");
    expect(repo.listTeams).toHaveBeenCalledWith(COMPANY_ID, "active", SCOPE_COND);
    // Bound theo CẶP DANH BẠ, không phải cặp gate (`read:team`).
    expect(dataScope.resolveOrNull).toHaveBeenCalledWith(ACTOR.id, ACTOR.companyId, "view", "user");
  });

  it("listTeams: không có grant danh bạ → BỎ HẲN khoá leaderUserName (N-1e, KI-052)", async () => {
    const repo = makeRepo();
    repo.listTeams.mockResolvedValueOnce([
      { id: TEAM_ID, name: "Team A", identityInScope: false, leaderUserName: null },
    ]);
    const { service, repo: r } = makeService(repo, makeDataScope(null));

    const rows = (await service.listTeams(ACTOR)) as Array<Record<string, unknown>>;

    expect(r.listTeams).toHaveBeenCalledWith(COMPANY_ID, undefined, null);
    expect(rows).toHaveLength(1);
    // Khoá phải VẮNG MẶT: contract khai `.nullable()` nên `null` KHÔNG phân biệt được
    // "chưa có trưởng nhóm" với "ngoài scope".
    expect("leaderUserName" in rows[0]).toBe(false);
    expect("identityInScope" in rows[0]).toBe(false);
  });

  it("createTeam maps fields + returns row", async () => {
    const { service, repo } = makeService();
    const row = await service.createTeam(COMPANY_ID, { name: "Team A", type: "production_team" });
    expect(row).toMatchObject({ id: TEAM_ID });
    expect(repo.createTeam).toHaveBeenCalledWith(
      COMPANY_ID,
      expect.objectContaining({ name: "Team A", type: "production_team" }),
    );
  });

  it("createTeam → Conflict on unique violation", async () => {
    const repo = makeRepo();
    repo.createTeam.mockRejectedValueOnce(PG_UNIQUE);
    const { service } = makeService(repo);
    await expect(
      service.createTeam(COMPANY_ID, { name: "Dup", type: "production_team" }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("createTeam → InternalServerError when insert returns nothing", async () => {
    const repo = makeRepo();
    repo.createTeam.mockResolvedValueOnce([]);
    const { service } = makeService(repo);
    await expect(
      service.createTeam(COMPANY_ID, { name: "X", type: "production_team" }),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it("updateTeam → NotFound when missing", async () => {
    const repo = makeRepo();
    repo.updateTeam.mockResolvedValueOnce([]);
    const { service } = makeService(repo);
    await expect(service.updateTeam(COMPANY_ID, TEAM_ID, { name: "X" })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("updateTeam → Conflict on unique violation", async () => {
    const repo = makeRepo();
    repo.updateTeam.mockRejectedValueOnce(PG_UNIQUE);
    const { service } = makeService(repo);
    await expect(service.updateTeam(COMPANY_ID, TEAM_ID, { code: "DUP" })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it("assignTeamLeader sets leaderUserId from leaderId", async () => {
    const { service, repo } = makeService();
    const row = await service.assignTeamLeader(COMPANY_ID, TEAM_ID, { leaderId: LEADER_ID });
    expect(row).toMatchObject({ leaderUserId: LEADER_ID });
    expect(repo.updateTeam).toHaveBeenCalledWith(COMPANY_ID, TEAM_ID, { leaderUserId: LEADER_ID });
  });

  it("assignTeamLeader → NotFound when team missing", async () => {
    const repo = makeRepo();
    repo.updateTeam.mockResolvedValueOnce([]);
    const { service } = makeService(repo);
    await expect(
      service.assignTeamLeader(COMPANY_ID, TEAM_ID, { leaderId: LEADER_ID }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("deleteTeam → NotFound when nothing deleted", async () => {
    const repo = makeRepo();
    repo.softDeleteTeam.mockResolvedValueOnce([]);
    const { service } = makeService(repo);
    await expect(service.deleteTeam(COMPANY_ID, TEAM_ID)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("deleteTeam resolves when a row was soft-deleted", async () => {
    const { service } = makeService();
    await expect(service.deleteTeam(COMPANY_ID, TEAM_ID)).resolves.toBeUndefined();
  });

  // ── Team members ───────────────────────────────────────────────────────────
  // S6-SEC-ORGTEAMSCOPE-1 (N-1c, KI-049): danh tính người bound theo cặp DANH BẠ, không theo `read:team`.
  // Vế hành vi thật (ai thấy email của ai) khoá ở `test/integration/org-team-members-scope.int-spec.ts`
  // — mock ở đây không chứng minh được điều đó, nó chỉ canh chữ ký call-site.
  it("listTeamMembers truyền vị từ scope danh bạ xuống repo", async () => {
    const { service, repo, dataScope } = makeService();
    await service.listTeamMembers(ACTOR, TEAM_ID);
    expect(dataScope.resolveOrNull).toHaveBeenCalledWith(ACTOR.id, ACTOR.companyId, "view", "user");
    expect(repo.listTeamMembers).toHaveBeenCalledWith(COMPANY_ID, TEAM_ID, SCOPE_COND);
  });

  it("listTeamMembers: KHÔNG grant danh bạ ⇒ repo nhận `null` (fail-closed), KHÔNG 403 cả route", async () => {
    const { service, repo } = makeService(makeRepo(), makeDataScope(null));
    await expect(service.listTeamMembers(ACTOR, TEAM_ID)).resolves.toBeInstanceOf(Array);
    expect(repo.listTeamMembers).toHaveBeenCalledWith(COMPANY_ID, TEAM_ID, null);
  });

  it("listTeamMembers: hàng ngoài scope bị BỎ KHOÁ danh tính, không phải trả null", async () => {
    const repo = makeRepo();
    repo.listTeamMembers.mockResolvedValueOnce([
      {
        id: "m1",
        userId: USER_ID,
        identityInScope: true,
        userFullName: "A",
        userEmail: "a@x.test",
      },
      { id: "m2", userId: LEADER_ID, identityInScope: false, userFullName: null, userEmail: null },
    ]);
    const { service } = makeService(repo);
    const rows = (await service.listTeamMembers(ACTOR, TEAM_ID)) as Record<string, unknown>[];
    expect(rows[0]).toMatchObject({ userEmail: "a@x.test", userFullName: "A" });
    // Khoá phải VẮNG MẶT: contract `teamMemberSchema.userEmail` không `.nullable()` ⇒ null vỡ Zod ở FE.
    expect("userEmail" in rows[1]!).toBe(false);
    expect("userFullName" in rows[1]!).toBe(false);
    // `identityInScope` là cột nội bộ của repo — KHÔNG được rò ra response.
    expect("identityInScope" in rows[0]!).toBe(false);
    expect("identityInScope" in rows[1]!).toBe(false);
  });

  it("addTeamMember → Conflict when already a member", async () => {
    const repo = makeRepo();
    repo.addTeamMember.mockRejectedValueOnce(PG_UNIQUE);
    const { service } = makeService(repo);
    await expect(
      service.addTeamMember(COMPANY_ID, TEAM_ID, { userId: USER_ID, roleName: "member" }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("addTeamMember → InternalServerError when insert returns nothing", async () => {
    const repo = makeRepo();
    repo.addTeamMember.mockResolvedValueOnce([]);
    const { service } = makeService(repo);
    await expect(
      service.addTeamMember(COMPANY_ID, TEAM_ID, { userId: USER_ID, roleName: "member" }),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it("addTeamMember resolves with row", async () => {
    const { service } = makeService();
    const row = await service.addTeamMember(COMPANY_ID, TEAM_ID, {
      userId: USER_ID,
      roleName: "member",
    });
    expect(row).toMatchObject({ userId: USER_ID });
  });

  it("removeTeamMember → NotFound when not a member", async () => {
    const repo = makeRepo();
    repo.removeTeamMember.mockResolvedValueOnce([]);
    const { service } = makeService(repo);
    await expect(service.removeTeamMember(COMPANY_ID, TEAM_ID, USER_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("removeTeamMember resolves when removed", async () => {
    const { service } = makeService();
    await expect(service.removeTeamMember(COMPANY_ID, TEAM_ID, USER_ID)).resolves.toBeUndefined();
  });

  // ── S6-SEC-ORGSCOPE-1 (N-1) — danh bạ phải BOUND theo data_scope ───────────────────────────────

  it("listEmployees resolve scope theo ĐÚNG cặp quyền mà controller gate", async () => {
    // Ca này khẳng định service resolve scope theo ĐÚNG hằng số, KHÔNG phải một cặp tự chế.
    //
    // ⚠️ NÓI RÕ NÓ *KHÔNG* CANH GÌ (FULL gate 2026-07-28 bắt được comment cũ nói quá): nó KHÔNG bắt
    // được "đổi decorator mà quên service". Spec này không chạm controller, và cả hai vế cùng import
    // một hằng số nên về mặt cấu trúc không có gì lệch được. Thứ THẬT SỰ chống trôi là:
    //   1. `import` chung ở `org.controller.ts` + `org.service.ts` (sự thật cấu trúc, không phải test),
    //   2. census literal ĐỘC LẬP ở `org.permissions.spec.ts` (route phải gate đúng cặp đó),
    //   3. `DIRECTORY_PAIR` literal ĐỘC LẬP ở `test/integration/org-directory-scope.int-spec.ts` —
    //      hằng số trôi ⇒ seed một cặp mà guard đòi cặp khác ⇒ 403 hàng loạt, ĐỎ TO TIẾNG (CI có chạy:
    //      `.github/workflows/api.yml` đặt LANE_DB cho step test).
    const { service, dataScope } = makeService();
    await service.listEmployees({ id: USER_ID, companyId: COMPANY_ID });
    expect(dataScope.resolveAndAssert).toHaveBeenCalledWith(
      USER_ID,
      COMPANY_ID,
      ORG_EMPLOYEE_DIRECTORY.action,
      ORG_EMPLOYEE_DIRECTORY.resourceType,
    );
  });

  it("listEmployees chuyển vị từ scope XUỐNG repository (không tự ý bỏ qua)", async () => {
    const { service, repo, dataScope } = makeService();
    await service.listEmployees({ id: USER_ID, companyId: COMPANY_ID });
    expect(dataScope.buildUserScopeCondition).toHaveBeenCalledWith("Company", {
      userId: USER_ID,
      companyId: COMPANY_ID,
    });
    // Vế QUAN TRỌNG NHẤT: repo nhận vị từ. Thiếu nó = hành vi rò cũ quay lại trong im lặng.
    expect(repo.listEmployees).toHaveBeenCalledWith(COMPANY_ID, SCOPE_COND);
  });

  it("listEmployees KHÔNG nuốt 403 của resolveAndAssert (fail-closed)", async () => {
    const dataScope = makeDataScope();
    dataScope.resolveAndAssert = vi.fn().mockRejectedValue(new ForbiddenException("no grant"));
    const { service, repo } = makeService(makeRepo(), dataScope);
    await expect(
      service.listEmployees({ id: USER_ID, companyId: COMPANY_ID }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.listEmployees).not.toHaveBeenCalled();
  });
});
