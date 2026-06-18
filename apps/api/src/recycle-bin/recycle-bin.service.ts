import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../events/audit.service';
import { DatabaseService } from '../db/db.service';
import { RecycleBinRepository } from './recycle-bin.repository';

type RequestUser = { id: string; companyId: string };

@Injectable()
export class RecycleBinService {
  constructor(
    private readonly repo: RecycleBinRepository,
    private readonly db: DatabaseService,
    private readonly auditService: AuditService,
  ) {}

  /** List all soft-deleted employee profiles for the caller's tenant. */
  listDeletedEmployees(user: RequestUser) {
    return this.db.withTenant(user.companyId, (tx) =>
      this.repo.listDeletedEmployeesTx(tx, user.companyId),
    );
  }

  /**
   * Restore a soft-deleted employee (clear deletedAt).
   * Audits the restore action inside the same transaction so the audit cannot succeed
   * without the restore committing (and vice-versa).
   */
  async restoreEmployee(user: RequestUser, id: string) {
    return this.db.withTenant(user.companyId, async (tx) => {
      const row = await this.repo.restoreEmployeeTx(tx, id, user.companyId);
      if (!row) throw new NotFoundException('Employee not found in recycle bin');

      await this.auditService.record(tx, {
        action: 'employee.restored',
        objectType: 'employee',
        objectId: id,
        actorUserId: user.id,
      });

      return row;
    });
  }
}
