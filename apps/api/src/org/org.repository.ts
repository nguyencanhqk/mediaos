import { Injectable } from "@nestjs/common";
import { and, eq, isNull, sql } from "drizzle-orm";
import { DatabaseService } from "../db/db.service";
import { orgUnits, teams, teamMembers, users, roles } from "../db/schema";
import { employeeProfiles } from "../db/schema/employees";
import { notOperatorRole } from "../permission/operator-roles";

@Injectable()
export class OrgRepository {
  constructor(private readonly db: DatabaseService) {}

  // ── Org Units ────────────────────────────────────────────────────────────────

  listOrgUnits(companyId: string, status?: string) {
    return this.db.withTenant(companyId, (tx) => {
      const where =
        status != null
          ? and(
              eq(orgUnits.companyId, companyId),
              isNull(orgUnits.deletedAt),
              eq(orgUnits.status, status),
            )
          : and(eq(orgUnits.companyId, companyId), isNull(orgUnits.deletedAt));
      return tx
        .select({
          id: orgUnits.id,
          companyId: orgUnits.companyId,
          parentId: orgUnits.parentId,
          name: orgUnits.name,
          type: orgUnits.type,
          code: orgUnits.code,
          description: orgUnits.description,
          headUserId: orgUnits.headUserId,
          headUserName: users.fullName,
          status: orgUnits.status,
          createdAt: orgUnits.createdAt,
          updatedAt: orgUnits.updatedAt,
        })
        .from(orgUnits)
        .leftJoin(users, eq(orgUnits.headUserId, users.id))
        .where(where)
        .orderBy(orgUnits.name);
    });
  }

  /** Lấy tất cả node cho buildTree — không filter status vì cần full tree. */
  async getOrgTree(companyId: string) {
    const rows = await this.db.withTenant(companyId, (tx) =>
      tx
        .select({
          id: orgUnits.id,
          parentId: orgUnits.parentId,
          name: orgUnits.name,
          type: orgUnits.type,
          code: orgUnits.code,
          status: orgUnits.status,
          headUserName: users.fullName,
        })
        .from(orgUnits)
        .leftJoin(users, eq(orgUnits.headUserId, users.id))
        .where(and(eq(orgUnits.companyId, companyId), isNull(orgUnits.deletedAt)))
        .orderBy(orgUnits.name),
    );
    return buildTree(rows, null);
  }

  createOrgUnit(
    companyId: string,
    data: {
      name: string;
      type: string;
      code?: string | null;
      description?: string | null;
      parentId?: string | null;
      headUserId?: string | null;
    },
  ) {
    return this.db.withTenant(companyId, (tx) =>
      tx
        .insert(orgUnits)
        .values({
          companyId,
          name: data.name,
          type: data.type,
          code: data.code ?? null,
          description: data.description ?? null,
          parentId: data.parentId ?? null,
          headUserId: data.headUserId ?? null,
        })
        .returning(),
    );
  }

  updateOrgUnit(
    companyId: string,
    id: string,
    data: Partial<{
      name: string;
      type: string;
      code: string | null;
      description: string | null;
      parentId: string | null;
      headUserId: string | null;
      status: string;
    }>,
  ) {
    return this.db.withTenant(companyId, (tx) =>
      tx
        .update(orgUnits)
        .set({ ...data, updatedAt: new Date() })
        .where(
          and(eq(orgUnits.companyId, companyId), eq(orgUnits.id, id), isNull(orgUnits.deletedAt)),
        )
        .returning(),
    );
  }

  softDeleteOrgUnit(companyId: string, id: string) {
    return this.db.withTenant(companyId, (tx) =>
      tx
        .update(orgUnits)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(
          and(eq(orgUnits.companyId, companyId), eq(orgUnits.id, id), isNull(orgUnits.deletedAt)),
        )
        .returning(),
    );
  }

  /**
   * G10-2 auto-room: user ids của nhân sự đang thuộc 1 phòng ban (employee_profiles.org_unit_id),
   * chưa nghỉ (deleted_at IS NULL). Qua withTenant(companyId) ⇒ RLS chặn kéo nhân sự tenant khác.
   */
  listOrgUnitMemberUserIds(companyId: string, orgUnitId: string): Promise<string[]> {
    return this.db.withTenant(companyId, async (tx) => {
      const rows = await tx
        .select({ userId: employeeProfiles.userId })
        .from(employeeProfiles)
        .where(
          and(
            eq(employeeProfiles.companyId, companyId),
            eq(employeeProfiles.orgUnitId, orgUnitId),
            isNull(employeeProfiles.deletedAt),
          ),
        );
      return rows.map((r) => r.userId);
    });
  }

  // ── Teams ────────────────────────────────────────────────────────────────────

  listTeams(companyId: string, status?: string) {
    return this.db.withTenant(companyId, (tx) => {
      const where =
        status != null
          ? and(eq(teams.companyId, companyId), isNull(teams.deletedAt), eq(teams.status, status))
          : and(eq(teams.companyId, companyId), isNull(teams.deletedAt));

      return tx
        .select({
          id: teams.id,
          companyId: teams.companyId,
          orgUnitId: teams.orgUnitId,
          name: teams.name,
          code: teams.code,
          type: teams.type,
          leaderUserId: teams.leaderUserId,
          leaderUserName: users.fullName,
          description: teams.description,
          capacity: teams.capacity,
          status: teams.status,
          createdAt: teams.createdAt,
          updatedAt: teams.updatedAt,
        })
        .from(teams)
        .leftJoin(users, eq(teams.leaderUserId, users.id))
        .where(where)
        .orderBy(teams.name);
    });
  }

  createTeam(
    companyId: string,
    data: {
      name: string;
      orgUnitId?: string | null;
      code?: string | null;
      type?: string;
      leaderUserId?: string | null;
      description?: string | null;
      capacity?: number | null;
    },
  ) {
    return this.db.withTenant(companyId, (tx) =>
      tx
        .insert(teams)
        .values({
          companyId,
          name: data.name,
          orgUnitId: data.orgUnitId ?? null,
          code: data.code ?? null,
          type: data.type ?? "production_team",
          leaderUserId: data.leaderUserId ?? null,
          description: data.description ?? null,
          capacity: data.capacity ?? null,
        })
        .returning(),
    );
  }

  updateTeam(
    companyId: string,
    id: string,
    data: Partial<{
      name: string;
      orgUnitId: string | null;
      code: string | null;
      type: string;
      leaderUserId: string | null;
      description: string | null;
      capacity: number | null;
      status: string;
    }>,
  ) {
    return this.db.withTenant(companyId, (tx) =>
      tx
        .update(teams)
        .set({ ...data, updatedAt: new Date() })
        .where(and(eq(teams.companyId, companyId), eq(teams.id, id), isNull(teams.deletedAt)))
        .returning(),
    );
  }

  softDeleteTeam(companyId: string, id: string) {
    return this.db.withTenant(companyId, (tx) =>
      tx
        .update(teams)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(teams.companyId, companyId), eq(teams.id, id), isNull(teams.deletedAt)))
        .returning(),
    );
  }

  // ── Team Members ──────────────────────────────────────────────────────────────

  listTeamMembers(companyId: string, teamId: string) {
    return this.db.withTenant(companyId, (tx) =>
      tx
        .select({
          id: teamMembers.id,
          teamId: teamMembers.teamId,
          userId: teamMembers.userId,
          roleName: teamMembers.roleName,
          joinedAt: teamMembers.joinedAt,
          userFullName: users.fullName,
          userEmail: users.email,
        })
        .from(teamMembers)
        .innerJoin(users, eq(teamMembers.userId, users.id))
        .innerJoin(teams, and(eq(teamMembers.teamId, teams.id), isNull(teams.deletedAt)))
        .where(
          and(
            eq(teamMembers.companyId, companyId),
            eq(teamMembers.teamId, teamId),
            isNull(teamMembers.deletedAt),
          ),
        ),
    );
  }

  addTeamMember(companyId: string, teamId: string, data: { userId: string; roleName: string }) {
    return this.db.withTenant(companyId, (tx) =>
      tx
        .insert(teamMembers)
        .values({ companyId, teamId, ...data })
        .returning(),
    );
  }

  removeTeamMember(companyId: string, teamId: string, userId: string) {
    return this.db.withTenant(companyId, (tx) =>
      tx
        .update(teamMembers)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(teamMembers.companyId, companyId),
            eq(teamMembers.teamId, teamId),
            eq(teamMembers.userId, userId),
            isNull(teamMembers.deletedAt),
          ),
        )
        .returning(),
    );
  }

  // ── Roles ────────────────────────────────────────────────────────────────────

  /**
   * Roles catalog cho dropdown "vai trò mặc định" của chức vụ (F4/F11) + màn Phân quyền (CS-2).
   * KHÔNG filter company_id: roles hệ thống có company_id NULL; RLS đã lộ đúng tập
   * (tenant + system) cho app role. Chỉ lấy bản chưa xoá, sắp theo tên.
   *
   * 🔴 CHẶN LEO THANG ĐẶC QUYỀN (CS-2, plan-review HIGH): LOẠI TRỪ role operator-audience (platform-admin
   * …f0). RLS lộ nó (company_id IS NULL) nhưng tenant KHÔNG được THẤY nó như lựa chọn gán (gán = leo thang
   * chéo tenant). `findAssignableRole` (permission-admin) đã chặn ở đường ghi; ở đây chặn ở đường ĐỌC danh
   * mục để UI không render lựa chọn cấm — phòng thủ theo tầng.
   */
  listRoles(companyId: string) {
    return this.db.withTenant(companyId, (tx) =>
      tx
        .select({ id: roles.id, name: roles.name })
        .from(roles)
        .where(and(isNull(roles.deletedAt), notOperatorRole()))
        .orderBy(roles.name),
    );
  }

  /** List employees (users) với team memberships — legacy endpoint G4-1. */
  async listEmployees(companyId: string) {
    return this.db.withTenant(companyId, async (tx) => {
      const userRows = await tx
        .select({
          id: users.id,
          email: users.email,
          fullName: users.fullName,
          status: users.status,
        })
        .from(users)
        .where(and(eq(users.companyId, companyId), isNull(users.deletedAt)));

      const memberRows = await tx
        .select({
          userId: teamMembers.userId,
          teamId: teamMembers.teamId,
          teamName: teams.name,
          roleName: teamMembers.roleName,
        })
        .from(teamMembers)
        .innerJoin(teams, and(eq(teamMembers.teamId, teams.id), isNull(teams.deletedAt)))
        .where(and(eq(teamMembers.companyId, companyId), isNull(teamMembers.deletedAt)));

      const membersByUser = new Map<
        string,
        { teamId: string; teamName: string; roleName: string }[]
      >();
      for (const m of memberRows) {
        const list = membersByUser.get(m.userId) ?? [];
        list.push({ teamId: m.teamId, teamName: m.teamName, roleName: m.roleName });
        membersByUser.set(m.userId, list);
      }

      return userRows.map((u) => ({
        ...u,
        teams: membersByUser.get(u.id) ?? [],
      }));
    });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

type FlatNode = {
  id: string;
  parentId: string | null;
  name: string;
  type: string;
  code: string | null | undefined;
  status: string;
  headUserName: string | null | undefined;
};

type TreeNode = FlatNode & { children: TreeNode[] };

function buildTree(nodes: FlatNode[], parentId: string | null): TreeNode[] {
  return nodes
    .filter((n) => n.parentId === parentId)
    .map((n) => ({ ...n, children: buildTree(nodes, n.id) }));
}
