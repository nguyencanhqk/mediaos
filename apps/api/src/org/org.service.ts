import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import type {
  AddTeamMemberRequest,
  CreateOrgUnitRequest,
  CreateTeamRequest,
} from '@mediaos/contracts';
import { OrgRepository } from './org.repository';

/** Postgres unique_violation error code. */
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

  listOrgUnits(companyId: string) {
    return this.repo.listOrgUnits(companyId);
  }

  async createOrgUnit(companyId: string, dto: CreateOrgUnitRequest) {
    const rows = await this.repo.createOrgUnit(companyId, {
      name: dto.name,
      type: dto.type,
      parentId: dto.parentId ?? null,
    });
    if (!rows[0]) throw new InternalServerErrorException('Failed to create department');
    return rows[0];
  }

  listTeams(companyId: string) {
    return this.repo.listTeams(companyId);
  }

  async createTeam(companyId: string, dto: CreateTeamRequest) {
    const rows = await this.repo.createTeam(companyId, {
      name: dto.name,
      orgUnitId: dto.orgUnitId ?? null,
    });
    if (!rows[0]) throw new InternalServerErrorException('Failed to create team');
    return rows[0];
  }

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
    if (rows.length === 0) {
      throw new NotFoundException('Team member not found');
    }
  }

  listEmployees(companyId: string) {
    return this.repo.listEmployees(companyId);
  }
}
