import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import type {
  AddTeamMemberRequest,
  AssignTeamLeaderRequest,
  CreateOrgUnitRequest,
  CreateTeamRequest,
  UpdateOrgUnitRequest,
  UpdateTeamRequest,
} from '@mediaos/contracts';
import { OrgRepository } from './org.repository';

const PG_UNIQUE_VIOLATION = '23505';

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as Record<string, unknown>)['code'] === PG_UNIQUE_VIOLATION
  );
}

@Injectable()
export class OrgService {
  constructor(private readonly repo: OrgRepository) {}

  // ── Org Units ────────────────────────────────────────────────────────────────

  listOrgUnits(companyId: string, status?: string) {
    return this.repo.listOrgUnits(companyId, status);
  }

  getOrgTree(companyId: string) {
    return this.repo.getOrgTree(companyId);
  }

  async createOrgUnit(companyId: string, dto: CreateOrgUnitRequest) {
    try {
      const rows = await this.repo.createOrgUnit(companyId, {
        name: dto.name,
        type: dto.type ?? 'department',
        code: dto.code ?? null,
        description: dto.description ?? null,
        parentId: dto.parentId ?? null,
        headUserId: dto.headUserId ?? null,
      });
      if (!rows[0]) throw new InternalServerErrorException('Failed to create department');
      return rows[0];
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException('Department name or code already exists');
      }
      throw err;
    }
  }

  async updateOrgUnit(companyId: string, id: string, dto: UpdateOrgUnitRequest) {
    try {
      const rows = await this.repo.updateOrgUnit(companyId, id, {
        name: dto.name,
        type: dto.type,
        code: dto.code,
        description: dto.description,
        parentId: dto.parentId,
        headUserId: dto.headUserId,
        status: dto.status,
      });
      if (!rows[0]) throw new NotFoundException('Department not found');
      return rows[0];
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException('Department name or code already exists');
      }
      throw err;
    }
  }

  async deleteOrgUnit(companyId: string, id: string) {
    const rows = await this.repo.softDeleteOrgUnit(companyId, id);
    if (rows.length === 0) throw new NotFoundException('Department not found');
  }

  // ── Teams ────────────────────────────────────────────────────────────────────

  listTeams(companyId: string, status?: string) {
    return this.repo.listTeams(companyId, status);
  }

  async createTeam(companyId: string, dto: CreateTeamRequest) {
    try {
      const rows = await this.repo.createTeam(companyId, {
        name: dto.name,
        orgUnitId: dto.orgUnitId ?? null,
        code: dto.code ?? null,
        type: dto.type ?? 'production_team',
        leaderUserId: dto.leaderUserId ?? null,
        description: dto.description ?? null,
        capacity: dto.capacity ?? null,
      });
      if (!rows[0]) throw new InternalServerErrorException('Failed to create team');
      return rows[0];
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException('Team name or code already exists');
      }
      throw err;
    }
  }

  async updateTeam(companyId: string, id: string, dto: UpdateTeamRequest) {
    try {
      const rows = await this.repo.updateTeam(companyId, id, {
        name: dto.name,
        orgUnitId: dto.orgUnitId,
        code: dto.code,
        type: dto.type,
        leaderUserId: dto.leaderUserId,
        description: dto.description,
        capacity: dto.capacity,
        status: dto.status,
      });
      if (!rows[0]) throw new NotFoundException('Team not found');
      return rows[0];
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException('Team name or code already exists');
      }
      throw err;
    }
  }

  async assignTeamLeader(companyId: string, teamId: string, dto: AssignTeamLeaderRequest) {
    const rows = await this.repo.updateTeam(companyId, teamId, {
      leaderUserId: dto.leaderId,
    });
    if (!rows[0]) throw new NotFoundException('Team not found');
    return rows[0];
  }

  async deleteTeam(companyId: string, id: string) {
    const rows = await this.repo.softDeleteTeam(companyId, id);
    if (rows.length === 0) throw new NotFoundException('Team not found');
  }

  // ── Team Members ──────────────────────────────────────────────────────────────

  listTeamMembers(companyId: string, teamId: string) {
    return this.repo.listTeamMembers(companyId, teamId);
  }

  async addTeamMember(companyId: string, teamId: string, dto: AddTeamMemberRequest) {
    try {
      const rows = await this.repo.addTeamMember(companyId, teamId, {
        userId: dto.userId,
        roleName: dto.roleName,
      });
      if (!rows[0]) throw new InternalServerErrorException('Failed to add team member');
      return rows[0];
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException('User is already an active member of this team');
      }
      throw err;
    }
  }

  async removeTeamMember(companyId: string, teamId: string, userId: string) {
    const rows = await this.repo.removeTeamMember(companyId, teamId, userId);
    if (rows.length === 0) throw new NotFoundException('Team member not found');
  }

  listEmployees(companyId: string) {
    return this.repo.listEmployees(companyId);
  }

  // ── Roles ──────────────────────────────────────────────────────────────────────

  listRoles(companyId: string) {
    return this.repo.listRoles(companyId);
  }
}
