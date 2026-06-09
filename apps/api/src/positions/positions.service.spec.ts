/**
 * G5-FIX F4 — Deny-path + audit RED suite for PositionsService.
 *
 * Hiện trạng (RED):
 *   - createPosition set default_role_id KHÔNG gác manage.position → bypass leo thang quyền (positions.service.ts:40-58).
 *   - assign-default-role chỉ có '// TODO audit' (positions.service.ts:81) → KHÔNG ghi audit_logs.
 *
 * Hành vi MONG MUỐN (post-F4):
 *   - Gán/đổi default_role_id (create HOẶC update) → BẮT BUỘC permission 'manage.position' (resource 'position'),
 *     thiếu → ForbiddenException (403).
 *   - Mỗi lần gán/đổi default_role_id thành công → 1 audit_logs (action='assign-default-role',
 *     object_type='position', before/after = { defaultRoleId }), ghi BÊN TRONG cùng withTenant tx (nguyên tử).
 *   - KHÔNG đụng default_role_id → KHÔNG gác manage.position, KHÔNG audit.
 */
import { ForbiddenException, NotFoundException, ConflictException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PositionsService } from './positions.service';
import type { PermissionDecision } from '../permission/permission.types';

const COMPANY_ID = '22222222-2222-2222-2222-222222222222';
const ACTOR_ID = '11111111-1111-1111-1111-111111111111';
const POS_ID = '33333333-3333-3333-3333-333333333333';
const ROLE_ID = '44444444-4444-4444-4444-444444444444';
const OLD_ROLE_ID = '55555555-5555-5555-5555-555555555555';

const ALLOW: PermissionDecision = { allow: true, reason: 'allow', auditRequired: false };
const DENY: PermissionDecision = { allow: false, reason: 'deny-sensitive', auditRequired: false };

const PG_UNIQUE_VIOLATION = { code: '23505' };

function makeRepo() {
  return {
    listPositions: vi.fn(),
    findById: vi.fn().mockResolvedValue([{ id: POS_ID, defaultRoleId: OLD_ROLE_ID, name: 'Editor' }]),
    createPosition: vi.fn().mockResolvedValue([{ id: POS_ID, defaultRoleId: ROLE_ID, name: 'Editor' }]),
    updatePosition: vi.fn().mockResolvedValue([{ id: POS_ID, defaultRoleId: ROLE_ID, name: 'Editor' }]),
    softDeletePosition: vi.fn().mockResolvedValue([{ id: POS_ID }]),
  };
}

/** withTenant mock chạy callback với 1 fake tx — đồng bộ style approval.service.spec.ts. */
function makeDb() {
  return {
    withTenant: vi
      .fn()
      .mockImplementation((_companyId: string, fn: (tx: unknown) => Promise<unknown>) =>
        fn({ __tx: true }),
      ),
  };
}

function makePerm(decision: PermissionDecision) {
  return { can: vi.fn().mockResolvedValue(decision) };
}

function makeAudit() {
  return { record: vi.fn().mockResolvedValue(undefined) };
}

function makeService(opts: {
  repo?: ReturnType<typeof makeRepo>;
  db?: ReturnType<typeof makeDb>;
  perm?: ReturnType<typeof makePerm>;
  audit?: ReturnType<typeof makeAudit>;
}) {
  const repo = opts.repo ?? makeRepo();
  const db = opts.db ?? makeDb();
  const perm = opts.perm ?? makePerm(ALLOW);
  const audit = opts.audit ?? makeAudit();
  const service = new PositionsService(
    repo as never,
    perm as never,
    db as never,
    audit as never,
  );
  return { service, repo, db, perm, audit };
}

describe('PositionsService — manage.position guard + assign-default-role audit (F4)', () => {
  beforeEach(() => vi.clearAllMocks());

  // ── CREATE ────────────────────────────────────────────────────────────────────
  describe('createPosition', () => {
    it('DENY: create with defaultRoleId but NO manage.position → 403 (no write, no audit)', async () => {
      const { service, repo, audit, perm } = makeService({ perm: makePerm(DENY) });

      await expect(
        service.createPosition(COMPANY_ID, ACTOR_ID, { name: 'Editor', defaultRoleId: ROLE_ID }),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(perm.can).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'manage.position', resourceType: 'position', userId: ACTOR_ID }),
      );
      expect(repo.createPosition).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('ALLOW: create with defaultRoleId + manage.position → writes + audit assign-default-role', async () => {
      const { service, repo, audit } = makeService({ perm: makePerm(ALLOW) });

      const result = await service.createPosition(COMPANY_ID, ACTOR_ID, {
        name: 'Editor',
        defaultRoleId: ROLE_ID,
      });

      expect(result).toMatchObject({ id: POS_ID });
      expect(repo.createPosition).toHaveBeenCalledOnce();
      expect(audit.record).toHaveBeenCalledOnce();
      expect(audit.record).toHaveBeenCalledWith(
        expect.anything(), // tx
        expect.objectContaining({
          action: 'assign-default-role',
          objectType: 'position',
          objectId: POS_ID,
          actorUserId: ACTOR_ID,
          before: { defaultRoleId: null },
          after: { defaultRoleId: ROLE_ID },
        }),
      );
    });

    it('create WITHOUT defaultRoleId → no manage.position check, no audit', async () => {
      const { service, repo, perm, audit } = makeService({});
      repo.createPosition.mockResolvedValueOnce([{ id: POS_ID, defaultRoleId: null, name: 'Editor' }]);

      await service.createPosition(COMPANY_ID, ACTOR_ID, { name: 'Editor' });

      expect(perm.can).not.toHaveBeenCalled();
      expect(repo.createPosition).toHaveBeenCalledOnce();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('maps unique violation → ConflictException', async () => {
      const repo = makeRepo();
      repo.createPosition.mockRejectedValueOnce(PG_UNIQUE_VIOLATION);
      const { service } = makeService({ repo });

      await expect(
        service.createPosition(COMPANY_ID, ACTOR_ID, { name: 'Dup' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  // ── UPDATE ────────────────────────────────────────────────────────────────────
  describe('updatePosition', () => {
    it('DENY: update default_role_id but NO manage.position → 403 (no write, no audit)', async () => {
      const { service, repo, audit } = makeService({ perm: makePerm(DENY) });

      await expect(
        service.updatePosition(COMPANY_ID, ACTOR_ID, POS_ID, { defaultRoleId: ROLE_ID }),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(repo.updatePosition).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('ALLOW: change default_role_id → audit before/after roles', async () => {
      const repo = makeRepo();
      repo.findById.mockResolvedValueOnce([{ id: POS_ID, defaultRoleId: OLD_ROLE_ID }]);
      repo.updatePosition.mockResolvedValueOnce([{ id: POS_ID, defaultRoleId: ROLE_ID }]);
      const { service, audit } = makeService({ repo, perm: makePerm(ALLOW) });

      await service.updatePosition(COMPANY_ID, ACTOR_ID, POS_ID, { defaultRoleId: ROLE_ID });

      expect(audit.record).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          action: 'assign-default-role',
          objectType: 'position',
          objectId: POS_ID,
          before: { defaultRoleId: OLD_ROLE_ID },
          after: { defaultRoleId: ROLE_ID },
        }),
      );
    });

    it('ALLOW: clear default_role_id (null) → still guarded + audited', async () => {
      const repo = makeRepo();
      repo.findById.mockResolvedValueOnce([{ id: POS_ID, defaultRoleId: OLD_ROLE_ID }]);
      repo.updatePosition.mockResolvedValueOnce([{ id: POS_ID, defaultRoleId: null }]);
      const { service, perm, audit } = makeService({ repo, perm: makePerm(ALLOW) });

      await service.updatePosition(COMPANY_ID, ACTOR_ID, POS_ID, { defaultRoleId: null });

      expect(perm.can).toHaveBeenCalledOnce();
      expect(audit.record).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ before: { defaultRoleId: OLD_ROLE_ID }, after: { defaultRoleId: null } }),
      );
    });

    it('update WITHOUT default_role_id → no manage.position check, no audit', async () => {
      const { service, repo, perm, audit } = makeService({});
      repo.updatePosition.mockResolvedValueOnce([{ id: POS_ID, defaultRoleId: OLD_ROLE_ID, name: 'Renamed' }]);

      await service.updatePosition(COMPANY_ID, ACTOR_ID, POS_ID, { name: 'Renamed' });

      expect(perm.can).not.toHaveBeenCalled();
      expect(repo.updatePosition).toHaveBeenCalledOnce();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('NotFound when changing role on missing position', async () => {
      const repo = makeRepo();
      repo.findById.mockResolvedValueOnce([]);
      const { service, audit } = makeService({ repo, perm: makePerm(ALLOW) });

      await expect(
        service.updatePosition(COMPANY_ID, ACTOR_ID, POS_ID, { defaultRoleId: ROLE_ID }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('update name only → maps fields, no role guard/audit, returns row', async () => {
      const { service, repo } = makeService({});
      repo.updatePosition.mockResolvedValueOnce([{ id: POS_ID, name: 'Renamed' }]);
      const row = await service.updatePosition(COMPANY_ID, ACTOR_ID, POS_ID, { name: 'Renamed' });
      expect(row).toMatchObject({ id: POS_ID, name: 'Renamed' });
      expect(repo.updatePosition).toHaveBeenCalledWith(
        COMPANY_ID,
        POS_ID,
        expect.objectContaining({ name: 'Renamed' }),
        expect.anything(),
      );
    });

    it('update name → NotFound when missing', async () => {
      const { service, repo } = makeService({});
      repo.updatePosition.mockResolvedValueOnce([]);
      await expect(
        service.updatePosition(COMPANY_ID, ACTOR_ID, POS_ID, { name: 'X' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('maps unique violation on update → ConflictException', async () => {
      const { service, repo } = makeService({});
      repo.updatePosition.mockRejectedValueOnce(PG_UNIQUE_VIOLATION);
      await expect(
        service.updatePosition(COMPANY_ID, ACTOR_ID, POS_ID, { code: 'DUP' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  // ── CRUD breadth (F3) ──────────────────────────────────────────────────────
  describe('list / get / delete', () => {
    it('listPositions forwards orgUnitId filter', async () => {
      const { service, repo } = makeService({});
      repo.listPositions.mockResolvedValueOnce([{ id: POS_ID }]);
      await service.listPositions(COMPANY_ID, 'org-1');
      expect(repo.listPositions).toHaveBeenCalledWith(COMPANY_ID, 'org-1');
    });

    it('getPosition returns row when found', async () => {
      const { service, repo } = makeService({});
      repo.findById.mockResolvedValueOnce([{ id: POS_ID, name: 'Editor' }]);
      await expect(service.getPosition(COMPANY_ID, POS_ID)).resolves.toMatchObject({ id: POS_ID });
    });

    it('getPosition → NotFound when missing', async () => {
      const { service, repo } = makeService({});
      repo.findById.mockResolvedValueOnce([]);
      await expect(service.getPosition(COMPANY_ID, POS_ID)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('deletePosition resolves when a row was soft-deleted', async () => {
      const { service, repo } = makeService({});
      repo.softDeletePosition.mockResolvedValueOnce([{ id: POS_ID }]);
      await expect(service.deletePosition(COMPANY_ID, POS_ID)).resolves.toBeUndefined();
    });

    it('deletePosition → NotFound when nothing deleted', async () => {
      const { service, repo } = makeService({});
      repo.softDeletePosition.mockResolvedValueOnce([]);
      await expect(service.deletePosition(COMPANY_ID, POS_ID)).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
