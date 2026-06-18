/**
 * CS-6 RecycleBinService unit tests (RED-GREEN TDD).
 *
 * Covers:
 *   - listDeletedEmployees: delegates to repo inside withTenant
 *   - restoreEmployee: updates row, writes audit, returns row
 *   - restoreEmployee: throws NotFoundException when row not found in recycle bin
 */

import { describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { RecycleBinService } from './recycle-bin.service';

// ─── Fixtures ──────────────────────────────────────────────────────────────────

const COMPANY_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const ACTOR_ID = '11111111-1111-1111-1111-111111111111';
const EMP_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

const actor = { id: ACTOR_ID, companyId: COMPANY_ID };

const deletedRow = {
  id: EMP_ID,
  userId: '22222222-2222-2222-2222-222222222222',
  employeeCode: 'E-001',
  userFullName: 'Nguyễn Văn A',
  userEmail: 'nva@co.test',
  orgUnitId: null,
  orgUnitName: null,
  positionId: null,
  positionName: null,
  workType: 'offline',
  employmentType: 'full_time',
  status: 'inactive',
  deletedAt: new Date('2026-06-01T00:00:00Z'),
};

// ─── Mock builders ──────────────────────────────────────────────────────────────

function makeRepo(overrides: Record<string, unknown> = {}) {
  return {
    listDeletedEmployeesTx: vi.fn().mockResolvedValue([deletedRow]),
    restoreEmployeeTx: vi.fn().mockResolvedValue({ id: EMP_ID }),
    ...overrides,
  };
}

function makeAudit() {
  return { record: vi.fn().mockResolvedValue(undefined) };
}

/**
 * withTenant executes the callback with a fake tx object and returns the result.
 * This mirrors the real DatabaseService.withTenant signature for unit tests.
 */
function makeDb() {
  const fakeTx = {};
  return {
    withTenant: vi.fn().mockImplementation(
      (_companyId: string, fn: (tx: unknown) => Promise<unknown>) => fn(fakeTx),
    ),
  };
}

function makeService(
  repoOverrides: Record<string, unknown> = {},
) {
  const repo = makeRepo(repoOverrides);
  const db = makeDb();
  const audit = makeAudit();

  const svc = new RecycleBinService(
    repo as never,
    db as never,
    audit as never,
  );
  return { svc, repo, db, audit };
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('RecycleBinService — listDeletedEmployees', () => {
  it('delegates to repo.listDeletedEmployeesTx inside withTenant', async () => {
    const { svc, repo, db } = makeService();

    const result = await svc.listDeletedEmployees(actor);

    expect(db.withTenant).toHaveBeenCalledWith(COMPANY_ID, expect.any(Function));
    expect(repo.listDeletedEmployeesTx).toHaveBeenCalledWith(expect.anything(), COMPANY_ID);
    expect(result).toEqual([deletedRow]);
  });

  it('returns empty array when no deleted employees', async () => {
    const { svc } = makeService({
      listDeletedEmployeesTx: vi.fn().mockResolvedValue([]),
    });

    const result = await svc.listDeletedEmployees(actor);
    expect(result).toEqual([]);
  });
});

describe('RecycleBinService — restoreEmployee', () => {
  it('calls restoreEmployeeTx + records audit inside withTenant', async () => {
    const { svc, repo, db, audit } = makeService();

    const result = await svc.restoreEmployee(actor, EMP_ID);

    expect(db.withTenant).toHaveBeenCalledWith(COMPANY_ID, expect.any(Function));
    expect(repo.restoreEmployeeTx).toHaveBeenCalledWith(expect.anything(), EMP_ID, COMPANY_ID);
    expect(audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'employee.restored',
        objectType: 'employee',
        objectId: EMP_ID,
        actorUserId: ACTOR_ID,
      }),
    );
    expect(result).toEqual({ id: EMP_ID });
  });

  it('throws NotFoundException when employee is not in recycle bin', async () => {
    const { svc } = makeService({
      restoreEmployeeTx: vi.fn().mockResolvedValue(undefined),
    });

    await expect(svc.restoreEmployee(actor, EMP_ID)).rejects.toThrow(NotFoundException);
  });

  it('does NOT write audit when restore tx returns undefined (not-found rollback path)', async () => {
    const { svc, audit } = makeService({
      restoreEmployeeTx: vi.fn().mockResolvedValue(undefined),
    });

    await expect(svc.restoreEmployee(actor, EMP_ID)).rejects.toThrow();
    expect(audit.record).not.toHaveBeenCalled();
  });
});
