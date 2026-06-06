import { Injectable } from '@nestjs/common';
import { and, eq, ilike, isNull } from 'drizzle-orm';
import { DatabaseService, type TenantTx } from '../db/db.service';
import {
  channels,
  projectChannels,
  projectMembers,
  projects,
  projectTeams,
  teams,
} from '../db/schema';

/** Input tạo project (đã validate ở DTO). numeric/date đã chuẩn hoá sang string|null ở service. */
export interface CreateProjectData {
  name: string;
  code?: string | null;
  projectType?: string | null;
  description?: string | null;
  orgUnitId?: string | null;
  ownerUserId?: string | null;
  projectManagerId?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  priority?: string | null;
  budget?: string | null;
}

/** Patch project — chỉ field có mặt mới đổi (partial). */
export interface UpdateProjectData {
  name?: string;
  code?: string | null;
  projectType?: string | null;
  description?: string | null;
  orgUnitId?: string | null;
  ownerUserId?: string | null;
  projectManagerId?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  priority?: string | null;
  budget?: string | null;
  status?: string;
}

export interface ListProjectsFilter {
  status?: string;
  projectType?: string;
  priority?: string;
  managerId?: string;
  q?: string;
}

export interface AddProjectChannelData {
  channelId: string;
  roleInProject?: string | null;
}

export interface UpdateProjectChannelData {
  roleInProject?: string | null;
  status?: string;
}

export interface AddProjectTeamData {
  teamId: string;
  roleInProject?: string | null;
}

export interface AddProjectMemberData {
  userId: string;
  roleInProject?: string | null;
  permissionLevel?: string | null;
  workloadPercent?: string | null;
  startDate?: string | null;
  endDate?: string | null;
}

export interface UpdateProjectMemberData {
  roleInProject?: string | null;
  permissionLevel?: string | null;
  workloadPercent?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  status?: string;
}

/** Normalize '' → NULL ở boundary (partial unique code dùng `code IS NOT NULL`). */
function normalizeOptional(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

@Injectable()
export class ProjectsRepository {
  constructor(private readonly db: DatabaseService) {}

  // ── Projects ─────────────────────────────────────────────────────────────

  async listProjects(companyId: string, filters: ListProjectsFilter = {}) {
    return this.db.withTenant(companyId, async (tx) => {
      const conds = [eq(projects.companyId, companyId), isNull(projects.deletedAt)];
      if (filters.status) conds.push(eq(projects.status, filters.status));
      if (filters.projectType) conds.push(eq(projects.projectType, filters.projectType));
      if (filters.priority) conds.push(eq(projects.priority, filters.priority));
      if (filters.managerId) conds.push(eq(projects.projectManagerId, filters.managerId));
      if (filters.q) conds.push(ilike(projects.name, `%${filters.q}%`));

      const projectRows = await tx
        .select()
        .from(projects)
        .where(and(...conds))
        .orderBy(projects.name);

      const channelRows = await tx
        .select({
          projectId: projectChannels.projectId,
          id: projectChannels.id,
          channelId: channels.id,
          name: channels.name,
          platform: channels.platform,
          roleInProject: projectChannels.roleInProject,
          status: projectChannels.status,
        })
        .from(projectChannels)
        .innerJoin(channels, and(eq(projectChannels.channelId, channels.id), isNull(channels.deletedAt)))
        .where(eq(projectChannels.companyId, companyId));

      const byProject = new Map<string, Omit<(typeof channelRows)[number], 'projectId'>[]>();
      for (const { projectId, ...link } of channelRows) {
        const list = byProject.get(projectId) ?? [];
        list.push(link);
        byProject.set(projectId, list);
      }

      return projectRows.map((p) => ({ ...p, channels: byProject.get(p.id) ?? [] }));
    });
  }

  /** Project + links (channels/teams/members) cho trang chi tiết. null nếu không tồn tại. */
  async findProjectById(companyId: string, projectId: string) {
    return this.db.withTenant(companyId, async (tx) => {
      const [project] = await tx
        .select()
        .from(projects)
        .where(and(eq(projects.companyId, companyId), eq(projects.id, projectId), isNull(projects.deletedAt)))
        .limit(1);
      if (!project) return null;

      const channelLinks = await tx
        .select({
          id: projectChannels.id,
          channelId: channels.id,
          name: channels.name,
          platform: channels.platform,
          roleInProject: projectChannels.roleInProject,
          status: projectChannels.status,
        })
        .from(projectChannels)
        .innerJoin(channels, and(eq(projectChannels.channelId, channels.id), isNull(channels.deletedAt)))
        .where(and(eq(projectChannels.companyId, companyId), eq(projectChannels.projectId, projectId)));

      const teamLinks = await tx
        .select({
          id: projectTeams.id,
          teamId: teams.id,
          name: teams.name,
          roleInProject: projectTeams.roleInProject,
        })
        .from(projectTeams)
        .innerJoin(teams, eq(projectTeams.teamId, teams.id))
        .where(and(eq(projectTeams.companyId, companyId), eq(projectTeams.projectId, projectId)));

      const memberRows = await tx
        .select()
        .from(projectMembers)
        .where(
          and(
            eq(projectMembers.companyId, companyId),
            eq(projectMembers.projectId, projectId),
            isNull(projectMembers.deletedAt),
          ),
        )
        .orderBy(projectMembers.createdAt);

      return { ...project, channels: channelLinks, teams: teamLinks, members: memberRows };
    });
  }

  /** Tồn tại + thuộc tenant + chưa xoá? (guard nhẹ cho link ops, tránh load toàn bộ detail). */
  async projectExists(companyId: string, projectId: string): Promise<boolean> {
    const rows = await this.db.withTenant(companyId, (tx) =>
      tx
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.companyId, companyId), eq(projects.id, projectId), isNull(projects.deletedAt)))
        .limit(1),
    );
    return rows.length > 0;
  }

  createProject(companyId: string, data: CreateProjectData, tx: TenantTx) {
    return tx
      .insert(projects)
      .values({
        companyId,
        name: data.name,
        code: normalizeOptional(data.code),
        projectType: data.projectType ?? null,
        description: data.description ?? null,
        orgUnitId: data.orgUnitId ?? null,
        ownerUserId: data.ownerUserId ?? null,
        projectManagerId: data.projectManagerId ?? null,
        startDate: data.startDate ?? null,
        endDate: data.endDate ?? null,
        priority: data.priority ?? null,
        budget: data.budget ?? null,
      })
      .returning();
  }

  updateProject(companyId: string, id: string, data: UpdateProjectData, tx: TenantTx) {
    const patch: Partial<typeof projects.$inferInsert> = { updatedAt: new Date() };
    if (data.name !== undefined) patch.name = data.name;
    if (data.code !== undefined) patch.code = normalizeOptional(data.code);
    if (data.projectType !== undefined) patch.projectType = data.projectType;
    if (data.description !== undefined) patch.description = data.description;
    if (data.orgUnitId !== undefined) patch.orgUnitId = data.orgUnitId;
    if (data.ownerUserId !== undefined) patch.ownerUserId = data.ownerUserId;
    if (data.projectManagerId !== undefined) patch.projectManagerId = data.projectManagerId;
    if (data.startDate !== undefined) patch.startDate = data.startDate;
    if (data.endDate !== undefined) patch.endDate = data.endDate;
    if (data.priority !== undefined) patch.priority = data.priority;
    if (data.budget !== undefined) patch.budget = data.budget;
    if (data.status !== undefined) patch.status = data.status;
    return tx
      .update(projects)
      .set(patch)
      .where(and(eq(projects.companyId, companyId), eq(projects.id, id), isNull(projects.deletedAt)))
      .returning();
  }

  softDeleteProject(companyId: string, id: string, tx: TenantTx) {
    return tx
      .update(projects)
      .set({ deletedAt: new Date() })
      .where(and(eq(projects.companyId, companyId), eq(projects.id, id), isNull(projects.deletedAt)))
      .returning();
  }

  // ── Project ↔ channels ───────────────────────────────────────────────────

  addProjectChannel(companyId: string, projectId: string, data: AddProjectChannelData, tx: TenantTx) {
    return tx
      .insert(projectChannels)
      .values({
        companyId,
        projectId,
        channelId: data.channelId,
        roleInProject: data.roleInProject ?? null,
      })
      .returning();
  }

  updateProjectChannel(
    companyId: string,
    projectId: string,
    channelId: string,
    data: UpdateProjectChannelData,
    tx: TenantTx,
  ) {
    const patch: Partial<typeof projectChannels.$inferInsert> = {};
    if (data.roleInProject !== undefined) patch.roleInProject = data.roleInProject;
    if (data.status !== undefined) patch.status = data.status;
    return tx
      .update(projectChannels)
      .set(patch)
      .where(
        and(
          eq(projectChannels.companyId, companyId),
          eq(projectChannels.projectId, projectId),
          eq(projectChannels.channelId, channelId),
        ),
      )
      .returning();
  }

  removeProjectChannel(companyId: string, projectId: string, channelId: string, tx: TenantTx) {
    return tx
      .delete(projectChannels)
      .where(
        and(
          eq(projectChannels.companyId, companyId),
          eq(projectChannels.projectId, projectId),
          eq(projectChannels.channelId, channelId),
        ),
      )
      .returning();
  }

  // ── Project ↔ teams ────────────────────────────────────────────────────────

  listProjectTeams(companyId: string, projectId: string) {
    return this.db.withTenant(companyId, (tx) =>
      tx
        .select({
          id: projectTeams.id,
          teamId: teams.id,
          name: teams.name,
          roleInProject: projectTeams.roleInProject,
        })
        .from(projectTeams)
        .innerJoin(teams, eq(projectTeams.teamId, teams.id))
        .where(and(eq(projectTeams.companyId, companyId), eq(projectTeams.projectId, projectId)))
        .orderBy(projectTeams.createdAt),
    );
  }

  addProjectTeam(companyId: string, projectId: string, data: AddProjectTeamData, tx: TenantTx) {
    return tx
      .insert(projectTeams)
      .values({ companyId, projectId, teamId: data.teamId, roleInProject: data.roleInProject ?? null })
      .returning();
  }

  removeProjectTeam(companyId: string, projectId: string, teamId: string, tx: TenantTx) {
    return tx
      .delete(projectTeams)
      .where(
        and(
          eq(projectTeams.companyId, companyId),
          eq(projectTeams.projectId, projectId),
          eq(projectTeams.teamId, teamId),
        ),
      )
      .returning();
  }

  // ── Project ↔ members ──────────────────────────────────────────────────────

  listProjectMembers(companyId: string, projectId: string) {
    return this.db.withTenant(companyId, (tx) =>
      tx
        .select()
        .from(projectMembers)
        .where(
          and(
            eq(projectMembers.companyId, companyId),
            eq(projectMembers.projectId, projectId),
            isNull(projectMembers.deletedAt),
          ),
        )
        .orderBy(projectMembers.createdAt),
    );
  }

  addProjectMember(companyId: string, projectId: string, data: AddProjectMemberData, tx: TenantTx) {
    return tx
      .insert(projectMembers)
      .values({
        companyId,
        projectId,
        userId: data.userId,
        roleInProject: data.roleInProject ?? null,
        permissionLevel: data.permissionLevel ?? null,
        workloadPercent: data.workloadPercent ?? null,
        startDate: data.startDate ?? null,
        endDate: data.endDate ?? null,
      })
      .returning();
  }

  updateProjectMember(
    companyId: string,
    projectId: string,
    memberId: string,
    data: UpdateProjectMemberData,
    tx: TenantTx,
  ) {
    const patch: Partial<typeof projectMembers.$inferInsert> = { updatedAt: new Date() };
    if (data.roleInProject !== undefined) patch.roleInProject = data.roleInProject;
    if (data.permissionLevel !== undefined) patch.permissionLevel = data.permissionLevel;
    if (data.workloadPercent !== undefined) patch.workloadPercent = data.workloadPercent;
    if (data.startDate !== undefined) patch.startDate = data.startDate;
    if (data.endDate !== undefined) patch.endDate = data.endDate;
    if (data.status !== undefined) patch.status = data.status;
    return tx
      .update(projectMembers)
      .set(patch)
      .where(
        and(
          eq(projectMembers.companyId, companyId),
          eq(projectMembers.projectId, projectId),
          eq(projectMembers.id, memberId),
          isNull(projectMembers.deletedAt),
        ),
      )
      .returning();
  }

  removeProjectMember(companyId: string, projectId: string, memberId: string, tx: TenantTx) {
    return tx
      .update(projectMembers)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(projectMembers.companyId, companyId),
          eq(projectMembers.projectId, projectId),
          eq(projectMembers.id, memberId),
          isNull(projectMembers.deletedAt),
        ),
      )
      .returning();
  }
}
