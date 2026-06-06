import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import type {
  CreateEmployeeProfileRequest,
  ImportEmployeeRow,
  UpdateEmployeeProfileRequest,
} from '@mediaos/contracts';
import { importEmployeeRowSchema } from '@mediaos/contracts';
import { AuditService } from '../events/audit.service';
import { DatabaseService } from '../db/db.service';
import { PermissionService } from '../permission/permission.service';
import type { CanInput } from '../permission/permission.types';
import { EmployeesRepository } from './employees.repository';

const PG_UNIQUE_VIOLATION = '23505';

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as Record<string, unknown>)['code'] === PG_UNIQUE_VIOLATION
  );
}

type SalaryMaskable = { baseSalary: unknown; id: string };

/**
 * Mask base_salary = null nếu user không có quyền view-salary.
 * BẤT BIẾN #3: base_salary KHÔNG vào DTO của role không có quyền.
 * isSensitive=true → wildcard grants (*:*) KHÔNG đủ (ADR-0010).
 */
async function applySalaryMask<T extends SalaryMaskable>(
  permissionService: PermissionService,
  requestingUser: { id: string; companyId: string },
  item: T,
): Promise<Omit<T, 'baseSalary'> & { baseSalary: number | null }> {
  const input: CanInput = {
    userId: requestingUser.id,
    companyId: requestingUser.companyId,
    action: 'view-salary',
    resourceType: 'employee',
    resourceId: item.id,
    isSensitive: true,
  };
  const decision = await permissionService.can(input);
  const salary = decision.allow && item.baseSalary != null ? Number(item.baseSalary) : null;
  return { ...item, baseSalary: salary };
}

/** In-memory session store for import preview (MVP). Production: Valkey TTL 5min. */
const ImportSessionStore = new Map<string, ImportEmployeeRow[]>();

function importSessionKey(companyId: string, userId: string, sessionId: string): string {
  return `${companyId}:${userId}:${sessionId}`;
}

@Injectable()
export class EmployeesService {
  constructor(
    private readonly repo: EmployeesRepository,
    private readonly db: DatabaseService,
    private readonly permissionService: PermissionService,
    private readonly auditService: AuditService,
  ) {}

  async listEmployees(
    requestingUser: { id: string; companyId: string },
    filters: { orgUnitId?: string; positionId?: string; status?: string },
  ) {
    const rows = await this.repo.listEmployees(requestingUser.companyId, filters);
    return Promise.all(
      rows.map((row) => applySalaryMask(this.permissionService, requestingUser, row)),
    );
  }

  async getEmployee(requestingUser: { id: string; companyId: string }, id: string) {
    const rows = await this.repo.findById(requestingUser.companyId, id);
    if (!rows[0]) throw new NotFoundException('Employee not found');
    return applySalaryMask(this.permissionService, requestingUser, rows[0]);
  }

  async createEmployee(
    requestingUser: { id: string; companyId: string },
    dto: CreateEmployeeProfileRequest,
  ) {
    try {
      const rows = await this.repo.createEmployee(requestingUser.companyId, {
        userId: dto.userId,
        employeeCode: dto.employeeCode ?? null,
        orgUnitId: dto.orgUnitId ?? null,
        positionId: dto.positionId ?? null,
        directManagerId: dto.directManagerId ?? null,
        workType: dto.workType,
        employmentType: dto.employmentType,
        startDate: dto.startDate ?? null,
        contractType: dto.contractType ?? null,
        baseSalary: dto.baseSalary != null ? String(dto.baseSalary) : null,
        salaryType: dto.salaryType,
        phone: dto.phone ?? null,
        avatarUrl: dto.avatarUrl ?? null,
        notes: dto.notes ?? null,
      });
      if (!rows[0]) throw new Error('Failed to create employee profile');
      return applySalaryMask(this.permissionService, requestingUser, rows[0]);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException('Employee code or user already has a profile in this company');
      }
      throw err;
    }
  }

  async updateEmployee(
    requestingUser: { id: string; companyId: string },
    id: string,
    dto: UpdateEmployeeProfileRequest,
  ) {
    // FULL gate: update base_salary cần permission update-salary (sensitive)
    if (dto.baseSalary !== undefined) {
      const input: CanInput = {
        userId: requestingUser.id,
        companyId: requestingUser.companyId,
        action: 'update-salary',
        resourceType: 'employee',
        resourceId: id,
        isSensitive: true,
      };
      const decision = await this.permissionService.can(input);
      if (!decision.allow) {
        throw new ForbiddenException('Insufficient permission to update salary');
      }
    }

    try {
      const rows = await this.repo.updateEmployee(requestingUser.companyId, id, {
        employeeCode: dto.employeeCode,
        orgUnitId: dto.orgUnitId,
        positionId: dto.positionId,
        directManagerId: dto.directManagerId,
        workType: dto.workType,
        employmentType: dto.employmentType,
        startDate: dto.startDate,
        endDate: dto.endDate,
        contractType: dto.contractType,
        baseSalary:
          dto.baseSalary !== undefined
            ? dto.baseSalary != null
              ? String(dto.baseSalary)
              : null
            : undefined,
        salaryType: dto.salaryType,
        phone: dto.phone,
        avatarUrl: dto.avatarUrl,
        notes: dto.notes,
        status: dto.status,
      });
      if (!rows[0]) throw new NotFoundException('Employee not found');
      return applySalaryMask(this.permissionService, requestingUser, rows[0]);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException('Employee code already exists');
      }
      throw err;
    }
  }

  async deleteEmployee(companyId: string, id: string) {
    const rows = await this.repo.softDeleteEmployee(companyId, id);
    if (rows.length === 0) throw new NotFoundException('Employee not found');
  }

  // ── Import CSV Phase 1: Parse + Validate ─────────────────────────────────────

  async parseImportPreview(
    companyId: string,
    userId: string,
    fileBuffer: Buffer,
    _contentType: string,
  ) {
    if (fileBuffer.length > 5 * 1024 * 1024) {
      throw new Error('File too large (max 5MB)');
    }

    // Lazy-load csv-parse to avoid top-level import issues in test environments
    const { parse } = await import('csv-parse/sync');
    let records: unknown[];
    try {
      records = parse(fileBuffer, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      }) as unknown[];
    } catch {
      throw new Error('Invalid CSV format');
    }

    const valid: ImportEmployeeRow[] = [];
    const invalid: { row: number; errors: string[] }[] = [];

    for (let i = 0; i < records.length; i++) {
      const result = importEmployeeRowSchema.safeParse(records[i]);
      if (result.success) {
        valid.push(result.data);
      } else {
        invalid.push({
          row: i + 2, // 1-based, +1 for header row
          errors: result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`),
        });
      }
    }

    const sessionId = randomUUID();
    ImportSessionStore.set(importSessionKey(companyId, userId, sessionId), valid);
    return { valid, invalid, sessionId };
  }

  // ── Import CSV Phase 2: Confirm + Bulk Insert ─────────────────────────────────

  async confirmImport(companyId: string, userId: string, sessionId: string) {
    const key = importSessionKey(companyId, userId, sessionId);
    const rows = ImportSessionStore.get(key);

    // DEL key TRƯỚC khi INSERT → chống double-submit (RFC-idempotent)
    ImportSessionStore.delete(key);

    if (!rows) {
      throw new ConflictException('Import session not found or already consumed');
    }

    // Re-validate lookups tại thời điểm confirm (org/position tên có thể đổi giữa preview và confirm)
    const insertData: Parameters<EmployeesRepository['bulkCreateEmployees']>[1] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const userRows = await this.repo.findUserByEmail(companyId, row.email);
      if (!userRows[0]) {
        throw new BadRequestException(`Row ${i + 2}: user not found in company`);
      }

      let orgUnitId: string | undefined;
      if (row.orgUnitName) {
        const ou = await this.repo.findOrgUnitByName(companyId, row.orgUnitName);
        if (!ou[0]) {
          throw new BadRequestException(
            `Row ${i + 2}: org unit not found (name may have changed since preview)`,
          );
        }
        orgUnitId = ou[0].id;
      }

      let positionId: string | undefined;
      if (row.positionName) {
        const pos = await this.repo.findPositionByName(companyId, row.positionName);
        if (!pos[0]) {
          throw new BadRequestException(
            `Row ${i + 2}: position not found (name may have changed since preview)`,
          );
        }
        positionId = pos[0].id;
      }

      insertData.push({
        userId: userRows[0].id,
        employeeCode: row.employeeCode,
        orgUnitId,
        positionId,
        workType: row.workType,
        employmentType: row.employmentType,
        startDate: row.startDate,
      });
    }

    const inserted = await this.repo.bulkCreateEmployees(companyId, insertData);
    return { inserted: inserted.length, failed: 0 };
  }
}
