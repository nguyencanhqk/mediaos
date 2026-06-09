import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { CreatePositionRequest, UpdatePositionRequest } from '@mediaos/contracts';
import { DatabaseService } from '../db/db.service';
import { AuditService } from '../events/audit.service';
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
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  listPositions(companyId: string, orgUnitId?: string) {
    return this.repo.listPositions(companyId, orgUnitId);
  }

  async getPosition(companyId: string, id: string) {
    const rows = await this.repo.findById(companyId, id);
    if (!rows[0]) throw new NotFoundException('Position not found');
    return rows[0];
  }

  /**
   * Gán default_role_id cho chức vụ = leo thang quyền tiềm tàng → BẮT BUỘC permission 'manage.position'
   * (FULL gate F4). Gọi TRƯỚC khi mở withTenant (permission check tự đọc DB/cache; tránh nested transaction
   * — đồng bộ với PermissionGuard toàn cục vốn chạy trước controller).
   * resourceId = id của position khi update (Tầng-3), undefined khi create (type-level "có được gán role?").
   * TOCTOU: có cửa sổ rất ngắn giữa check và write nếu quyền bị thu hồi giữa chừng — chấp nhận được
   * (độ trễ thu hồi ≤ TTL cache permission; không để lại trạng thái sai vĩnh viễn).
   */
  private async assertCanManagePosition(
    companyId: string,
    actorUserId: string,
    resourceId?: string,
  ): Promise<void> {
    const input: CanInput = {
      userId: actorUserId,
      companyId,
      action: 'manage.position',
      resourceType: 'position',
      resourceId,
      isSensitive: false,
    };
    const decision = await this.permissionService.can(input);
    if (!decision.allow) {
      throw new ForbiddenException('Insufficient permission to assign default role to position');
    }
  }

  async createPosition(companyId: string, actorUserId: string, dto: CreatePositionRequest) {
    // Bypass-guard (F4): set default_role_id lúc tạo cũng phải qua manage.position như khi PATCH.
    const assigningRole = dto.defaultRoleId !== undefined && dto.defaultRoleId !== null;
    if (assigningRole) {
      await this.assertCanManagePosition(companyId, actorUserId);
    }

    try {
      return await this.db.withTenant(companyId, async (tx) => {
        const rows = await this.repo.createPosition(
          companyId,
          {
            name: dto.name,
            code: dto.code ?? null,
            orgUnitId: dto.orgUnitId ?? null,
            level: dto.level ?? null,
            description: dto.description ?? null,
            defaultRoleId: dto.defaultRoleId ?? null,
          },
          tx,
        );
        const created = rows[0];
        if (!created) throw new Error('Failed to create position');

        if (assigningRole) {
          // Audit nguyên tử cùng tx — rollback chung nếu insert lỗi (BẤT BIẾN #2).
          await this.audit.record(tx, {
            action: 'assign-default-role',
            objectType: 'position',
            objectId: created.id,
            actorUserId,
            before: { defaultRoleId: null },
            after: { defaultRoleId: dto.defaultRoleId ?? null },
          });
        }
        return created;
      });
    } catch (err) {
      // Giữ nguyên err gốc (pg DatabaseError: constraint, detail) để không mất dấu vết debug.
      if (isUniqueViolation(err)) {
        throw new ConflictException('Position name or code already exists', { cause: err });
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
    // Gán/đổi/xoá default_role_id (kể cả set null) đều cần manage.position (F4).
    const changingRole = dto.defaultRoleId !== undefined;
    if (changingRole) {
      await this.assertCanManagePosition(companyId, actorUserId, id);
    }

    try {
      return await this.db.withTenant(companyId, async (tx) => {
        let beforeRoleId: string | null = null;
        if (changingRole) {
          const existing = await this.repo.findById(companyId, id, tx);
          if (!existing[0]) throw new NotFoundException('Position not found');
          beforeRoleId = existing[0].defaultRoleId ?? null;
        }

        const rows = await this.repo.updatePosition(
          companyId,
          id,
          {
            name: dto.name,
            code: dto.code,
            orgUnitId: dto.orgUnitId,
            level: dto.level,
            description: dto.description,
            defaultRoleId: dto.defaultRoleId,
            status: dto.status,
          },
          tx,
        );
        const updated = rows[0];
        if (!updated) throw new NotFoundException('Position not found');

        if (changingRole) {
          await this.audit.record(tx, {
            action: 'assign-default-role',
            objectType: 'position',
            objectId: id,
            actorUserId,
            before: { defaultRoleId: beforeRoleId },
            after: { defaultRoleId: dto.defaultRoleId ?? null },
          });
        }
        return updated;
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException('Position name or code already exists', { cause: err });
      }
      throw err;
    }
  }

  async deletePosition(companyId: string, id: string) {
    const rows = await this.repo.softDeletePosition(companyId, id);
    if (rows.length === 0) throw new NotFoundException('Position not found');
  }
}
