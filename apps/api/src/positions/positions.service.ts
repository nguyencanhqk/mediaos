import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { CreatePositionRequest, UpdatePositionRequest } from '@mediaos/contracts';
import { PermissionService } from '../permission/permission.service';
import type { CanInput } from '../permission/permission.types';
import { PositionsRepository } from './positions.repository';

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
export class PositionsService {
  constructor(
    private readonly repo: PositionsRepository,
    private readonly permissionService: PermissionService,
  ) {}

  listPositions(companyId: string, orgUnitId?: string) {
    return this.repo.listPositions(companyId, orgUnitId);
  }

  async getPosition(companyId: string, id: string) {
    const rows = await this.repo.findById(companyId, id);
    if (!rows[0]) throw new NotFoundException('Position not found');
    return rows[0];
  }

  async createPosition(companyId: string, actorUserId: string, dto: CreatePositionRequest) {
    try {
      const rows = await this.repo.createPosition(companyId, {
        name: dto.name,
        code: dto.code ?? null,
        orgUnitId: dto.orgUnitId ?? null,
        level: dto.level ?? null,
        description: dto.description ?? null,
        defaultRoleId: dto.defaultRoleId ?? null,
      });
      if (!rows[0]) throw new Error('Failed to create position');
      return rows[0];
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException('Position name or code already exists');
      }
      throw err;
    }
  }

  async updatePosition(
    companyId: string,
    actorUserId: string,
    id: string,
    dto: UpdatePositionRequest,
  ) {
    // FULL gate: gán default_role_id cần permission manage.position
    if (dto.defaultRoleId !== undefined) {
      const input: CanInput = {
        userId: actorUserId,
        companyId,
        action: 'manage.position',
        resourceType: 'position',
        resourceId: id,
        isSensitive: false,
      };
      const decision = await this.permissionService.can(input);
      if (!decision.allow) {
        throw new ForbiddenException('Insufficient permission to assign default role to position');
      }

      // TODO: audit 'assign-default-role' inside withTenant tx once DatabaseService is injected here.
    }

    try {
      const rows = await this.repo.updatePosition(companyId, id, {
        name: dto.name,
        code: dto.code,
        orgUnitId: dto.orgUnitId,
        level: dto.level,
        description: dto.description,
        defaultRoleId: dto.defaultRoleId,
        status: dto.status,
      });
      if (!rows[0]) throw new NotFoundException('Position not found');
      return rows[0];
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException('Position name or code already exists');
      }
      throw err;
    }
  }

  async deletePosition(companyId: string, id: string) {
    const rows = await this.repo.softDeletePosition(companyId, id);
    if (rows.length === 0) throw new NotFoundException('Position not found');
  }
}
