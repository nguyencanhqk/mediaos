import { Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { DatabaseService } from '../db/db.service';
import { orgUnits, teams, teamMembers, users } from '../db/schema';

@Injectable()
export class OrgRepository {
  constructor(private readonly db: DatabaseService) {}

  listOrgUnits(companyId: string) {
    return this.db.withTenant(companyId, (tx) =>
      tx
        .select()
        .from(orgUnits)
        .where(and(eq(orgUnits.companyId, companyId), isNull(orgUnits.deletedAt)))
        .orderBy(orgUnits.name),
    );
  }

  createOrgUnit(
    companyId: string,
    data: { name: string; type: string; parentId?: string | null },
  ) {
    return this.db.withTenant(companyId, (tx) =>
      tx
        .insert(orgUnits)
        .values({ companyId, ...data, parentId: data.parentId ?? null })
        .returning(),
    );
  }

  listTeams(companyId: string) {
    return this.db.withTenant(companyId, (tx) =>
      tx
        .select()
        .from(teams)
        .where(and(eq(teams.companyId, companyId), isNull(teams.deletedAt)))
        .orderBy(teams.name),
    );
  }

  createTeam(companyId: string, data: { name: string; orgUnitId?: string | null }) {
    return this.db.withTenant(companyId, (tx) =>
      tx
        .insert(teams)
        .values({ companyId, ...data, orgUnitId: data.orgUnitId ?? null })
        .returning(),
    );
  }

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

  addTeamMember(
    companyId: string,
    teamId: string,
    data: { userId: string; roleName: string },
  ) {
    return this.db.withTenant(companyId, (tx) =>
      tx.insert(teamMembers).values({ companyId, teamId, ...data }).returning(),
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

  /** List employees (users) với team memberships. */
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
