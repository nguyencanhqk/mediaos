import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import type {
  AddProjectChannelRequest,
  AddProjectMemberRequest,
  AddProjectTeamRequest,
  CreateProjectRequest,
  UpdateProjectChannelRequest,
  UpdateProjectMemberRequest,
  UpdateProjectRequest,
} from '@mediaos/contracts';
import { DatabaseService } from '../db/db.service';
import { AuditService } from '../events/audit.service';
import { ChatService } from '../chat/chat.service';
import { ProjectsRepository, type ListProjectsFilter } from './projects.repository';

const PG_UNIQUE_VIOLATION = '23505';
const PG_FK_VIOLATION = '23503';

function pgErrorCode(err: unknown): string | undefined {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    return (err as Record<string, unknown>)['code'] as string | undefined;
  }
  return undefined;
}

/** numeric/decimal contract (number) → Drizzle numeric (string). undefined → bỏ qua patch; null → clear. */
function numToStr(v: number | null | undefined): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  return String(v);
}

interface RequestUser {
  id: string;
  companyId: string;
}

@Injectable()
export class ProjectsService {
  constructor(
    private readonly repo: ProjectsRepository,
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly chat: ChatService,
  ) {}

  // ── Projects ─────────────────────────────────────────────────────────────

  listProjects(companyId: string, filters: ListProjectsFilter) {
    return this.repo.listProjects(companyId, filters);
  }

  async getProject(companyId: string, projectId: string) {
    const project = await this.repo.findProjectById(companyId, projectId);
    if (!project) throw new NotFoundException(`Project not found: ${projectId}`);
    return project;
  }

  async createProject(user: RequestUser, dto: CreateProjectRequest) {
    let project: Awaited<ReturnType<ProjectsRepository['createProject']>>[number];
    try {
      project = await this.db.withTenant(user.companyId, async (tx) => {
        const rows = await this.repo.createProject(
          user.companyId,
          {
            name: dto.name,
            code: dto.code ?? null,
            projectType: dto.projectType ?? null,
            description: dto.description ?? null,
            orgUnitId: dto.orgUnitId ?? null,
            ownerUserId: dto.ownerUserId ?? null,
            projectManagerId: dto.projectManagerId ?? null,
            startDate: dto.startDate ?? null,
            endDate: dto.endDate ?? null,
            priority: dto.priority ?? null,
            budget: numToStr(dto.budget) ?? null,
          },
          tx,
        );
        if (!rows[0]) throw new InternalServerErrorException('Failed to create project');
        await this.audit.record(tx, {
          action: 'ProjectCreated',
          objectType: 'project',
          objectId: rows[0].id,
          actorUserId: user.id,
          after: { name: rows[0].name, code: rows[0].code, projectType: rows[0].projectType },
        });
        return rows[0];
      });
    } catch (err) {
      if (pgErrorCode(err) === PG_UNIQUE_VIOLATION) {
        throw new ConflictException('Project name or code already exists');
      }
      throw err;
    }

    // Auto-tạo phòng chat project (non-critical — lỗi không rollback project).
    await this.chat.ensureProjectRoom(user.companyId, project.id, project.name, user.id);

    return project;
  }

  async updateProject(user: RequestUser, id: string, dto: UpdateProjectRequest) {
    try {
      return await this.db.withTenant(user.companyId, async (tx) => {
        const rows = await this.repo.updateProject(
          user.companyId,
          id,
          {
            name: dto.name,
            code: dto.code,
            projectType: dto.projectType,
            description: dto.description,
            orgUnitId: dto.orgUnitId,
            ownerUserId: dto.ownerUserId,
            projectManagerId: dto.projectManagerId,
            startDate: dto.startDate,
            endDate: dto.endDate,
            priority: dto.priority,
            budget: numToStr(dto.budget),
            status: dto.status,
          },
          tx,
        );
        if (!rows[0]) throw new NotFoundException(`Project not found: ${id}`);
        await this.audit.record(tx, {
          action: 'ProjectUpdated',
          objectType: 'project',
          objectId: id,
          actorUserId: user.id,
          after: { changed: Object.keys(dto) },
        });
        return rows[0];
      });
    } catch (err) {
      if (pgErrorCode(err) === PG_UNIQUE_VIOLATION) {
        throw new ConflictException('Project name or code already exists');
      }
      throw err;
    }
  }

  async deleteProject(user: RequestUser, id: string) {
    await this.db.withTenant(user.companyId, async (tx) => {
      const rows = await this.repo.softDeleteProject(user.companyId, id, tx);
      if (rows.length === 0) throw new NotFoundException(`Project not found: ${id}`);
      await this.audit.record(tx, {
        action: 'ProjectDeleted',
        objectType: 'project',
        objectId: id,
        actorUserId: user.id,
      });
    });
  }

  // ── Project ↔ channels ───────────────────────────────────────────────────

  async addProjectChannel(user: RequestUser, projectId: string, dto: AddProjectChannelRequest) {
    await this.assertProjectExists(user.companyId, projectId);
    try {
      return await this.db.withTenant(user.companyId, async (tx) => {
        const rows = await this.repo.addProjectChannel(
          user.companyId,
          projectId,
          { channelId: dto.channelId, roleInProject: dto.roleInProject ?? null },
          tx,
        );
        if (!rows[0]) throw new InternalServerErrorException('Failed to link channel to project');
        await this.audit.record(tx, {
          action: 'ProjectChannelLinked',
          objectType: 'project',
          objectId: projectId,
          actorUserId: user.id,
          after: { channelId: dto.channelId, roleInProject: dto.roleInProject ?? null },
        });
        return rows[0];
      });
    } catch (err) {
      const code = pgErrorCode(err);
      if (code === PG_UNIQUE_VIOLATION) throw new ConflictException('Channel already linked to this project');
      if (code === PG_FK_VIOLATION) throw new NotFoundException(`Channel not found: ${dto.channelId}`);
      throw err;
    }
  }

  async updateProjectChannel(
    user: RequestUser,
    projectId: string,
    channelId: string,
    dto: UpdateProjectChannelRequest,
  ) {
    return this.db.withTenant(user.companyId, async (tx) => {
      const rows = await this.repo.updateProjectChannel(user.companyId, projectId, channelId, dto, tx);
      if (!rows[0]) throw new NotFoundException('Channel not linked to this project');
      await this.audit.record(tx, {
        action: 'ProjectChannelUpdated',
        objectType: 'project',
        objectId: projectId,
        actorUserId: user.id,
        after: { channelId, changed: Object.keys(dto) },
      });
      return rows[0];
    });
  }

  async removeProjectChannel(user: RequestUser, projectId: string, channelId: string) {
    await this.db.withTenant(user.companyId, async (tx) => {
      const rows = await this.repo.removeProjectChannel(user.companyId, projectId, channelId, tx);
      if (rows.length === 0) throw new NotFoundException('Channel not linked to this project');
      await this.audit.record(tx, {
        action: 'ProjectChannelUnlinked',
        objectType: 'project',
        objectId: projectId,
        actorUserId: user.id,
        after: { channelId },
      });
    });
  }

  // ── Project ↔ teams ────────────────────────────────────────────────────────

  async listProjectTeams(companyId: string, projectId: string) {
    await this.assertProjectExists(companyId, projectId);
    return this.repo.listProjectTeams(companyId, projectId);
  }

  async addProjectTeam(user: RequestUser, projectId: string, dto: AddProjectTeamRequest) {
    await this.assertProjectExists(user.companyId, projectId);
    try {
      return await this.db.withTenant(user.companyId, async (tx) => {
        const rows = await this.repo.addProjectTeam(
          user.companyId,
          projectId,
          { teamId: dto.teamId, roleInProject: dto.roleInProject ?? null },
          tx,
        );
        if (!rows[0]) throw new InternalServerErrorException('Failed to link team to project');
        await this.audit.record(tx, {
          action: 'ProjectTeamLinked',
          objectType: 'project_team',
          objectId: rows[0].id,
          actorUserId: user.id,
          after: { projectId, teamId: dto.teamId, roleInProject: dto.roleInProject ?? null },
        });
        return rows[0];
      });
    } catch (err) {
      const code = pgErrorCode(err);
      if (code === PG_UNIQUE_VIOLATION) throw new ConflictException('Team already linked to this project');
      if (code === PG_FK_VIOLATION) throw new NotFoundException(`Team not found: ${dto.teamId}`);
      throw err;
    }
  }

  async removeProjectTeam(user: RequestUser, projectId: string, teamId: string) {
    await this.db.withTenant(user.companyId, async (tx) => {
      const rows = await this.repo.removeProjectTeam(user.companyId, projectId, teamId, tx);
      if (rows.length === 0) throw new NotFoundException('Team not linked to this project');
      await this.audit.record(tx, {
        action: 'ProjectTeamUnlinked',
        objectType: 'project_team',
        objectId: rows[0].id,
        actorUserId: user.id,
        after: { projectId, teamId },
      });
    });
  }

  // ── Project ↔ members ──────────────────────────────────────────────────────

  async listProjectMembers(companyId: string, projectId: string) {
    await this.assertProjectExists(companyId, projectId);
    return this.repo.listProjectMembers(companyId, projectId);
  }

  async addProjectMember(user: RequestUser, projectId: string, dto: AddProjectMemberRequest) {
    await this.assertProjectExists(user.companyId, projectId);
    try {
      return await this.db.withTenant(user.companyId, async (tx) => {
        const rows = await this.repo.addProjectMember(
          user.companyId,
          projectId,
          {
            userId: dto.userId,
            roleInProject: dto.roleInProject ?? null,
            permissionLevel: dto.permissionLevel ?? null,
            workloadPercent: numToStr(dto.workloadPercent) ?? null,
            startDate: dto.startDate ?? null,
            endDate: dto.endDate ?? null,
          },
          tx,
        );
        if (!rows[0]) throw new InternalServerErrorException('Failed to add project member');
        await this.audit.record(tx, {
          action: 'ProjectMemberAdded',
          objectType: 'project_member',
          objectId: rows[0].id,
          actorUserId: user.id,
          after: { projectId, userId: dto.userId, roleInProject: dto.roleInProject ?? null },
        });
        return rows[0];
      });
    } catch (err) {
      const code = pgErrorCode(err);
      if (code === PG_UNIQUE_VIOLATION) throw new ConflictException('User already a member of this project');
      if (code === PG_FK_VIOLATION) throw new NotFoundException(`User not found: ${dto.userId}`);
      throw err;
    }
  }

  async updateProjectMember(
    user: RequestUser,
    projectId: string,
    memberId: string,
    dto: UpdateProjectMemberRequest,
  ) {
    return this.db.withTenant(user.companyId, async (tx) => {
      const rows = await this.repo.updateProjectMember(
        user.companyId,
        projectId,
        memberId,
        {
          roleInProject: dto.roleInProject,
          permissionLevel: dto.permissionLevel,
          workloadPercent: numToStr(dto.workloadPercent),
          startDate: dto.startDate,
          endDate: dto.endDate,
          status: dto.status,
        },
        tx,
      );
      if (!rows[0]) throw new NotFoundException(`Project member not found: ${memberId}`);
      await this.audit.record(tx, {
        action: 'ProjectMemberUpdated',
        objectType: 'project_member',
        objectId: memberId,
        actorUserId: user.id,
        after: { changed: Object.keys(dto) },
      });
      return rows[0];
    });
  }

  async removeProjectMember(user: RequestUser, projectId: string, memberId: string) {
    await this.db.withTenant(user.companyId, async (tx) => {
      const rows = await this.repo.removeProjectMember(user.companyId, projectId, memberId, tx);
      if (rows.length === 0) throw new NotFoundException(`Project member not found: ${memberId}`);
      await this.audit.record(tx, {
        action: 'ProjectMemberRemoved',
        objectType: 'project_member',
        objectId: memberId,
        actorUserId: user.id,
      });
    });
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private async assertProjectExists(companyId: string, projectId: string): Promise<void> {
    if (!(await this.repo.projectExists(companyId, projectId))) {
      throw new NotFoundException(`Project not found: ${projectId}`);
    }
  }
}
