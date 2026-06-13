/**
 * G5-FIX F3 — Breadth/happy-path suite for OrgService (org_units + teams + members).
 *
 * Phủ logic nghiệp vụ (mock repo): mapping field, default type, NotFound/Conflict/Internal,
 * PATCH team leader, soft-delete. Repository (DB-bound) phủ riêng bằng RLS integration registry.
 */
import { ConflictException, InternalServerErrorException, NotFoundException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OrgService } from "./org.service";

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
    // G10-2: createOrgUnit auto-tạo group chat phòng ban → cần nguồn member-set.
    listOrgUnitMemberUserIds: vi.fn().mockResolvedValue([]),
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

/** G10-2: OrgService phụ thuộc ChatService (auto-room phòng ban). Mock no-op best-effort. */
function makeChat() {
  return { ensureOrgUnitRoom: vi.fn().mockResolvedValue(null) };
}

function makeService(repo = makeRepo(), chat = makeChat()) {
  return { service: new OrgService(repo as never, chat as never), repo, chat };
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
  it("listTeams forwards status filter", async () => {
    const { service, repo } = makeService();
    await service.listTeams(COMPANY_ID, "active");
    expect(repo.listTeams).toHaveBeenCalledWith(COMPANY_ID, "active");
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
  it("listTeamMembers returns members", async () => {
    const { service, repo } = makeService();
    await service.listTeamMembers(COMPANY_ID, TEAM_ID);
    expect(repo.listTeamMembers).toHaveBeenCalledWith(COMPANY_ID, TEAM_ID);
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

  it("listEmployees (legacy) returns rows", async () => {
    const { service, repo } = makeService();
    await service.listEmployees(COMPANY_ID);
    expect(repo.listEmployees).toHaveBeenCalledWith(COMPANY_ID);
  });
});
