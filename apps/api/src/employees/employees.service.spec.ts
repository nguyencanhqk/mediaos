/**
 * G5-FIX deny-path RED suite for EmployeesService.
 *
 * F1 (🔴 crown-jewel — salary audit, BẤT BIẾN #3):
 *   - view-salary: deny → base_salary=null & NO audit; allow → number & 1 audit row per view
 *   - list: per-item mask; per allowed item → 1 audit row
 *   - update-salary: no permission → 403; allow → audit before/after
 *
 * F5 (EMR consistency), F6 (import hardening), F7 (login account), F8 (search)
 * are appended below as each step lands.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { EmployeesService } from './employees.service';

// ─── Fixtures ──────────────────────────────────────────────────────────────────

const COMPANY_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const ACTOR_ID = '11111111-1111-1111-1111-111111111111';
const EMP_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const EMP_USER_ID = '22222222-2222-2222-2222-222222222222';
const EMP2_ID = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
const EMP2_USER_ID = '33333333-3333-3333-3333-333333333333';
const MANAGER_ID = '44444444-4444-4444-4444-444444444444';

const actor = { id: ACTOR_ID, companyId: COMPANY_ID };

type Decision = { allow: boolean; reason: string; auditRequired: boolean };
const ALLOW = (auditRequired = true): Decision => ({ allow: true, reason: 'allow', auditRequired });
const DENY = (reason = 'deny-sensitive'): Decision => ({ allow: false, reason, auditRequired: true });

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: EMP_ID,
    companyId: COMPANY_ID,
    userId: EMP_USER_ID,
    employeeCode: 'E-001',
    orgUnitId: null,
    orgUnitName: null,
    positionId: null,
    positionName: null,
    directManagerId: null,
    workType: 'offline',
    employmentType: 'full_time',
    startDate: null,
    endDate: null,
    contractType: null,
    baseSalary: '5000.00',
    salaryType: 'monthly',
    phone: null,
    avatarUrl: null,
    notes: null,
    status: 'active',
    userFullName: 'Nguyen Van A',
    userEmail: 'a@co.test',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function makeRepo(overrides: Record<string, unknown> = {}) {
  return {
    listEmployeesTx: vi.fn().mockResolvedValue([makeRow()]),
    findByIdTx: vi.fn().mockResolvedValue(makeRow()),
    createEmployeeTx: vi.fn().mockResolvedValue([makeRow()]),
    updateEmployeeTx: vi.fn().mockResolvedValue([makeRow()]),
    softDeleteEmployee: vi.fn().mockResolvedValue([makeRow()]),
    createUserTx: vi.fn().mockResolvedValue({ id: EMP_USER_ID }),
    softDeleteDirectManagerEmrTx: vi.fn().mockResolvedValue(undefined),
    insertDirectManagerEmrTx: vi.fn().mockResolvedValue(undefined),
    findUserByEmailTx: vi.fn().mockResolvedValue({ id: EMP_USER_ID }),
    findOrgUnitByNameTx: vi.fn().mockResolvedValue({ id: 'org-1' }),
    findPositionByNameTx: vi.fn().mockResolvedValue({ id: 'pos-1' }),
    bulkCreateEmployeesTx: vi.fn().mockResolvedValue([{ id: EMP_ID }]),
    ...overrides,
  };
}

const FAKE_TX = { __tx: true };

function makeDb() {
  return {
    withTenant: vi.fn(
      (_companyId: string, fn: (tx: unknown) => Promise<unknown>) => fn(FAKE_TX),
    ),
  };
}

function makePermission(perms: Record<string, Decision>) {
  return {
    can: vi.fn((input: { action: string }) =>
      Promise.resolve(perms[input.action] ?? DENY('deny-default')),
    ),
  };
}

function makeAudit() {
  return { record: vi.fn().mockResolvedValue(undefined) };
}

function makeValkey(overrides: Record<string, unknown> = {}) {
  return {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(true),
    del: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

function makePassword() {
  return { hash: vi.fn().mockResolvedValue('argon2-hash') };
}

function makeService(opts: {
  perms?: Record<string, Decision>;
  repo?: ReturnType<typeof makeRepo>;
  valkey?: ReturnType<typeof makeValkey>;
} = {}) {
  const repo = opts.repo ?? makeRepo();
  const db = makeDb();
  const permission = makePermission(opts.perms ?? {});
  const audit = makeAudit();
  const valkey = opts.valkey ?? makeValkey();
  const password = makePassword();
  const svc = new EmployeesService(
    repo as never,
    db as never,
    permission as never,
    audit as never,
    valkey as never,
    password as never,
  );
  return { svc, repo, db, permission, audit, valkey, password };
}

// ─── F1: Salary audit (crown-jewel) ─────────────────────────────────────────────

describe('EmployeesService — F1 salary mask + audit', () => {
  describe('getEmployee (view-salary)', () => {
    it('DENY: employee viewing another → base_salary=null, NO audit row', async () => {
      const { svc, audit } = makeService({ perms: { 'view-salary': DENY() } });
      const res = await svc.getEmployee(actor, EMP_ID);
      expect(res.baseSalary).toBeNull();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('DENY: team_leader without view_sensitive → base_salary=null', async () => {
      const { svc, audit } = makeService({ perms: { 'view-salary': DENY('deny-scope') } });
      const res = await svc.getEmployee(actor, EMP_ID);
      expect(res.baseSalary).toBeNull();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('ALLOW: HR_manager → base_salary=number AND exactly 1 view-salary audit row', async () => {
      const { svc, audit } = makeService({ perms: { 'view-salary': ALLOW() } });
      const res = await svc.getEmployee(actor, EMP_ID);
      expect(res.baseSalary).toBe(5000);
      expect(audit.record).toHaveBeenCalledTimes(1);
      expect(audit.record).toHaveBeenCalledWith(
        FAKE_TX,
        expect.objectContaining({
          action: 'view-salary',
          objectType: 'employee',
          objectId: EMP_ID,
          actorUserId: ACTOR_ID,
        }),
      );
    });

    it('ALLOW but auditRequired=false → salary MASKED, no audit (never reveal without auditing)', async () => {
      const { svc, audit } = makeService({ perms: { 'view-salary': ALLOW(false) } });
      const res = await svc.getEmployee(actor, EMP_ID);
      expect(res.baseSalary).toBeNull();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('throws NotFound when row missing (no audit)', async () => {
      const repo = makeRepo({ findByIdTx: vi.fn().mockResolvedValue(undefined) });
      const { svc, audit } = makeService({ perms: { 'view-salary': ALLOW() }, repo });
      await expect(svc.getEmployee(actor, EMP_ID)).rejects.toThrow(NotFoundException);
      expect(audit.record).not.toHaveBeenCalled();
    });
  });

  describe('listEmployees (per-item mask + audit)', () => {
    it('DENY: normal user → every base_salary=null, NO audit', async () => {
      const repo = makeRepo({
        listEmployeesTx: vi
          .fn()
          .mockResolvedValue([makeRow(), makeRow({ id: EMP2_ID, userId: EMP2_USER_ID })]),
      });
      const { svc, audit } = makeService({ perms: { 'view-salary': DENY() }, repo });
      const res = await svc.listEmployees(actor, {});
      expect(res).toHaveLength(2);
      expect(res.every((r) => r.baseSalary === null)).toBe(true);
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('ALLOW: HR_manager → numbers AND 1 audit row per viewed item', async () => {
      const repo = makeRepo({
        listEmployeesTx: vi
          .fn()
          .mockResolvedValue([makeRow(), makeRow({ id: EMP2_ID, userId: EMP2_USER_ID })]),
      });
      const { svc, audit } = makeService({ perms: { 'view-salary': ALLOW() }, repo });
      const res = await svc.listEmployees(actor, {});
      expect(res.map((r) => r.baseSalary)).toEqual([5000, 5000]);
      expect(audit.record).toHaveBeenCalledTimes(2);
    });
  });

  describe('updateEmployee (update-salary)', () => {
    it('DENY: PATCH base_salary without update-salary → 403, no write', async () => {
      const repo = makeRepo();
      const { svc } = makeService({ perms: { 'update-salary': DENY() }, repo });
      await expect(svc.updateEmployee(actor, EMP_ID, { baseSalary: 9000 })).rejects.toThrow(
        ForbiddenException,
      );
      expect(repo.updateEmployeeTx).not.toHaveBeenCalled();
    });

    it('ALLOW: PATCH base_salary → update-salary audit with before/after', async () => {
      const repo = makeRepo({
        findByIdTx: vi.fn().mockResolvedValue(makeRow({ baseSalary: '5000.00' })),
        updateEmployeeTx: vi.fn().mockResolvedValue([makeRow({ baseSalary: '9000.00' })]),
      });
      const { svc, audit } = makeService({
        perms: { 'update-salary': ALLOW(), 'view-salary': ALLOW() },
        repo,
      });
      await svc.updateEmployee(actor, EMP_ID, { baseSalary: 9000 });
      expect(audit.record).toHaveBeenCalledWith(
        FAKE_TX,
        expect.objectContaining({
          action: 'update-salary',
          objectType: 'employee',
          objectId: EMP_ID,
          before: { base_salary: 5000 },
          after: { base_salary: 9000 },
        }),
      );
    });

    it('non-salary PATCH does not require update-salary permission', async () => {
      const repo = makeRepo();
      const { svc } = makeService({ perms: {}, repo });
      await expect(svc.updateEmployee(actor, EMP_ID, { phone: '0900' })).resolves.toBeDefined();
      expect(repo.updateEmployeeTx).toHaveBeenCalledTimes(1);
    });
  });

  describe('createEmployee (set-salary)', () => {
    it('DENY: create with base_salary without update-salary → 403, no salary audit', async () => {
      const repo = makeRepo();
      const { svc, audit } = makeService({ perms: { 'update-salary': DENY() }, repo });
      await expect(
        svc.createEmployee(actor, {
          userId: EMP_USER_ID,
          baseSalary: 9000,
          workType: 'offline',
          employmentType: 'full_time',
          salaryType: 'monthly',
        } as never),
      ).rejects.toThrow(ForbiddenException);
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('ALLOW: create with base_salary → update-salary audit (before null / after value)', async () => {
      const repo = makeRepo();
      const { svc, audit } = makeService({ perms: { 'update-salary': ALLOW() }, repo });
      await svc.createEmployee(actor, {
        userId: EMP_USER_ID,
        baseSalary: 9000,
        workType: 'offline',
        employmentType: 'full_time',
        salaryType: 'monthly',
      } as never);
      expect(audit.record).toHaveBeenCalledWith(
        FAKE_TX,
        expect.objectContaining({
          action: 'update-salary',
          objectType: 'employee',
          objectId: EMP_ID,
          before: { base_salary: null },
          after: { base_salary: 9000 },
        }),
      );
    });

    it('create WITHOUT base_salary does not require update-salary permission', async () => {
      const repo = makeRepo();
      const { svc, audit } = makeService({ perms: {}, repo });
      await expect(
        svc.createEmployee(actor, {
          userId: EMP_USER_ID,
          workType: 'offline',
          employmentType: 'full_time',
          salaryType: 'monthly',
        } as never),
      ).resolves.toBeDefined();
      expect(audit.record).not.toHaveBeenCalled();
      expect(repo.createEmployeeTx).toHaveBeenCalledTimes(1);
    });
  });
});

// ─── F5: EMR direct_manager consistency ─────────────────────────────────────────

describe('EmployeesService — F5 EMR sync', () => {
  it('create with directManagerId → soft-delete prior + insert EMR row', async () => {
    const repo = makeRepo({
      createEmployeeTx: vi.fn().mockResolvedValue([makeRow({ userId: EMP_USER_ID })]),
    });
    const { svc } = makeService({ repo });
    await svc.createEmployee(actor, {
      userId: EMP_USER_ID,
      directManagerId: MANAGER_ID,
      workType: 'offline',
      employmentType: 'full_time',
      salaryType: 'monthly',
    } as never);
    expect(repo.softDeleteDirectManagerEmrTx).toHaveBeenCalledWith(
      expect.anything(),
      COMPANY_ID,
      EMP_USER_ID,
    );
    expect(repo.insertDirectManagerEmrTx).toHaveBeenCalledWith(
      expect.anything(),
      COMPANY_ID,
      EMP_USER_ID,
      MANAGER_ID,
    );
  });

  it('create without directManagerId → no EMR write', async () => {
    const repo = makeRepo();
    const { svc } = makeService({ repo });
    await svc.createEmployee(actor, {
      userId: EMP_USER_ID,
      workType: 'offline',
      employmentType: 'full_time',
      salaryType: 'monthly',
    } as never);
    expect(repo.softDeleteDirectManagerEmrTx).not.toHaveBeenCalled();
    expect(repo.insertDirectManagerEmrTx).not.toHaveBeenCalled();
  });

  it('update set directManagerId → soft-delete + insert', async () => {
    const repo = makeRepo({
      updateEmployeeTx: vi.fn().mockResolvedValue([makeRow({ userId: EMP_USER_ID })]),
    });
    const { svc } = makeService({ repo });
    await svc.updateEmployee(actor, EMP_ID, { directManagerId: MANAGER_ID });
    expect(repo.softDeleteDirectManagerEmrTx).toHaveBeenCalledTimes(1);
    expect(repo.insertDirectManagerEmrTx).toHaveBeenCalledWith(
      expect.anything(),
      COMPANY_ID,
      EMP_USER_ID,
      MANAGER_ID,
    );
  });

  it('update clear directManagerId=null → soft-delete only (EMR removed)', async () => {
    const repo = makeRepo({
      updateEmployeeTx: vi.fn().mockResolvedValue([makeRow({ userId: EMP_USER_ID })]),
    });
    const { svc } = makeService({ repo });
    await svc.updateEmployee(actor, EMP_ID, { directManagerId: null });
    expect(repo.softDeleteDirectManagerEmrTx).toHaveBeenCalledTimes(1);
    expect(repo.insertDirectManagerEmrTx).not.toHaveBeenCalled();
  });

  it('update untouched directManagerId (undefined) → no EMR write', async () => {
    const repo = makeRepo({
      updateEmployeeTx: vi.fn().mockResolvedValue([makeRow({ userId: EMP_USER_ID })]),
    });
    const { svc } = makeService({ repo });
    await svc.updateEmployee(actor, EMP_ID, { phone: '0900' });
    expect(repo.softDeleteDirectManagerEmrTx).not.toHaveBeenCalled();
  });

  it('rejects an employee managing themselves', async () => {
    const repo = makeRepo({
      updateEmployeeTx: vi.fn().mockResolvedValue([makeRow({ userId: EMP_USER_ID })]),
    });
    const { svc } = makeService({ repo });
    await expect(
      svc.updateEmployee(actor, EMP_ID, { directManagerId: EMP_USER_ID }),
    ).rejects.toThrow(BadRequestException);
  });
});

// ─── F6: Import hardening (Valkey session, content-type, single tx) ──────────────

describe('EmployeesService — F6 import hardening', () => {
  const CSV = 'email,fullName\nalice@co.test,Alice\n';

  describe('parseImportPreview', () => {
    it('rejects a non-CSV content-type (no session staged)', async () => {
      const { svc, valkey } = makeService();
      await expect(
        svc.parseImportPreview(COMPANY_ID, ACTOR_ID, Buffer.from(CSV), 'application/json'),
      ).rejects.toThrow(BadRequestException);
      expect(valkey.set).not.toHaveBeenCalled();
    });

    it('accepts text/csv and stages the batch in Valkey with a 5-min TTL', async () => {
      const { svc, valkey } = makeService();
      const res = await svc.parseImportPreview(COMPANY_ID, ACTOR_ID, Buffer.from(CSV), 'text/csv');
      expect(res.valid).toHaveLength(1);
      expect(res.invalid).toHaveLength(0);
      expect(typeof res.sessionId).toBe('string');
      expect(valkey.set).toHaveBeenCalledWith(
        expect.stringContaining(`import:${COMPANY_ID}:${ACTOR_ID}:`),
        expect.any(String),
        300,
      );
    });

    it('staging failure (Valkey SET error) → 503, not a misleading later 409', async () => {
      const valkey = makeValkey({ set: vi.fn().mockResolvedValue(false) });
      const { svc } = makeService({ valkey });
      await expect(
        svc.parseImportPreview(COMPANY_ID, ACTOR_ID, Buffer.from(CSV), 'text/csv'),
      ).rejects.toThrow(ServiceUnavailableException);
    });
  });

  describe('confirmImport', () => {
    const staged = JSON.stringify([{ email: 'alice@co.test', fullName: 'Alice' }]);

    it('inserts staged rows and consumes the key (DEL before insert)', async () => {
      const valkey = makeValkey({ get: vi.fn().mockResolvedValue(staged) });
      const repo = makeRepo();
      const { svc } = makeService({ valkey, repo });
      const res = await svc.confirmImport(COMPANY_ID, ACTOR_ID, 'sess-1');
      expect(res).toEqual({ inserted: 1, failed: 0 });
      expect(valkey.del).toHaveBeenCalledTimes(1);
      expect(repo.bulkCreateEmployeesTx).toHaveBeenCalledTimes(1);
    });

    it('double-submit → second confirm 409 (key already consumed)', async () => {
      let call = 0;
      const valkey = makeValkey({
        get: vi.fn(() => Promise.resolve(call++ === 0 ? staged : null)),
      });
      const { svc } = makeService({ valkey });
      await svc.confirmImport(COMPANY_ID, ACTOR_ID, 'sess-1');
      await expect(svc.confirmImport(COMPANY_ID, ACTOR_ID, 'sess-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('expired/missing session (TTL elapsed) → 409', async () => {
      const valkey = makeValkey({ get: vi.fn().mockResolvedValue(null) });
      const { svc } = makeService({ valkey });
      await expect(svc.confirmImport(COMPANY_ID, ACTOR_ID, 'sess-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('stale lookup (user renamed/removed since preview) → clear per-row error', async () => {
      const valkey = makeValkey({
        get: vi.fn().mockResolvedValue(JSON.stringify([{ email: 'ghost@co.test', fullName: 'G' }])),
      });
      const repo = makeRepo({ findUserByEmailTx: vi.fn().mockResolvedValue(undefined) });
      const { svc } = makeService({ valkey, repo });
      await expect(svc.confirmImport(COMPANY_ID, ACTOR_ID, 'sess-1')).rejects.toThrow(
        /Row 2: user not found/,
      );
      expect(repo.bulkCreateEmployeesTx).not.toHaveBeenCalled();
    });

    it('cannot consume the key (Valkey DEL error) → 503, no insert', async () => {
      const valkey = makeValkey({
        get: vi.fn().mockResolvedValue(staged),
        del: vi.fn().mockResolvedValue(false),
      });
      const repo = makeRepo();
      const { svc } = makeService({ valkey, repo });
      await expect(svc.confirmImport(COMPANY_ID, ACTOR_ID, 'sess-1')).rejects.toThrow(
        ServiceUnavailableException,
      );
      expect(repo.bulkCreateEmployeesTx).not.toHaveBeenCalled();
    });

    it('tampered/invalid staged payload → 400 (re-validated, not trusted)', async () => {
      const valkey = makeValkey({
        get: vi.fn().mockResolvedValue(JSON.stringify([{ email: 'not-an-email', fullName: '' }])),
      });
      const repo = makeRepo();
      const { svc } = makeService({ valkey, repo });
      await expect(svc.confirmImport(COMPANY_ID, ACTOR_ID, 'sess-1')).rejects.toThrow(
        BadRequestException,
      );
      expect(repo.bulkCreateEmployeesTx).not.toHaveBeenCalled();
    });

    it('racing duplicate import (unique violation on bulk insert) → 409', async () => {
      const valkey = makeValkey({ get: vi.fn().mockResolvedValue(staged) });
      const repo = makeRepo({
        bulkCreateEmployeesTx: vi.fn().mockRejectedValue({ code: '23505' }),
      });
      const { svc } = makeService({ valkey, repo });
      await expect(svc.confirmImport(COMPANY_ID, ACTOR_ID, 'sess-1')).rejects.toThrow(
        ConflictException,
      );
    });
  });
});

// ─── F7: create login account when no userId supplied ───────────────────────────

describe('EmployeesService — F7 login-account creation', () => {
  it('creates a users row when userId is omitted (EMP-001)', async () => {
    const repo = makeRepo({
      createUserTx: vi.fn().mockResolvedValue({ id: EMP_USER_ID }),
      createEmployeeTx: vi.fn().mockResolvedValue([makeRow({ userId: EMP_USER_ID })]),
    });
    const { svc, password } = makeService({ repo });
    const res = await svc.createEmployee(actor, {
      email: 'new@co.test',
      fullName: 'New Hire',
      workType: 'offline',
      employmentType: 'full_time',
      salaryType: 'monthly',
    } as never);
    expect(password.hash).toHaveBeenCalledTimes(1);
    expect(repo.createUserTx).toHaveBeenCalledWith(
      expect.anything(),
      COMPANY_ID,
      expect.objectContaining({ email: 'new@co.test', fullName: 'New Hire', passwordHash: 'argon2-hash' }),
    );
    expect(repo.createEmployeeTx).toHaveBeenCalledWith(
      expect.anything(),
      COMPANY_ID,
      expect.objectContaining({ userId: EMP_USER_ID }),
    );
    expect(res).toBeDefined();
  });

  it('rejects create with neither userId nor email+fullName', async () => {
    const { svc } = makeService();
    await expect(
      svc.createEmployee(actor, {
        workType: 'offline',
        employmentType: 'full_time',
        salaryType: 'monthly',
      } as never),
    ).rejects.toThrow(BadRequestException);
  });

  it('reuses an existing userId without creating an account', async () => {
    const repo = makeRepo();
    const { svc, password } = makeService({ repo });
    await svc.createEmployee(actor, {
      userId: EMP_USER_ID,
      workType: 'offline',
      employmentType: 'full_time',
      salaryType: 'monthly',
    } as never);
    expect(repo.createUserTx).not.toHaveBeenCalled();
    expect(password.hash).not.toHaveBeenCalled();
  });
});

// ─── F8: search filter ───────────────────────────────────────────────────────────

describe('EmployeesService — F8 search filter', () => {
  it('forwards the search term to the repository', async () => {
    const repo = makeRepo({ listEmployeesTx: vi.fn().mockResolvedValue([]) });
    const { svc } = makeService({ repo });
    await svc.listEmployees(actor, { search: 'alice' });
    expect(repo.listEmployeesTx).toHaveBeenCalledWith(
      expect.anything(),
      COMPANY_ID,
      expect.objectContaining({ search: 'alice' }),
    );
  });
});
