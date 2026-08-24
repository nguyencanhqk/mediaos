import { describe, expect, it, vi } from "vitest";
import type { DatabaseService } from "../db/db.service";
import type { AuditService } from "../events/audit.service";
import type { OutboxService } from "../events/outbox.service";
import type { SecurityEventWriter } from "../auth/security-event-writer.service";
import type { PermissionService } from "./permission.service";
import type { PermissionAdminRepository } from "./permission-admin.repository";
import { PermissionAdminService } from "./permission-admin.service";

/**
 * S10-SEC-ROLEMEMBERFE-1 (KI-073) — tầng KHÔNG-CẦN-POSTGRES của D2: thân trả về của `assignRole`
 * phải là ĐÚNG BỐN KHOÁ `{userId, roleId, companyId, expiresAt}` echo request, GIỐNG HỆT ở cả ba
 * nhánh (no-op / fresh / reassign) — `id`/`grantedBy`/`createdAt` của hàng DB không được rò ra.
 *
 * ⚠️ BA ca dùng BA BỘ SENTINEL KHÁC NHAU (memory `same-builder-twice-makes-unit-spec-vacuous`):
 * dùng chung một builder/giá trị thì đột biến "trả nguyên hàng" vẫn xanh ở ít nhất một ca — hai hàng
 * giống nhau thì "chiếu" và "trả thẳng" không phân biệt được.
 *
 * Mỗi ca kèm MỘT assert điều-kiện-tồn-tại (nhánh nào thực sự chạy: insert có/không được gọi, delete
 * có/không được gọi) — thiếu nó, một thay đổi ở `sameExpiry`/`findUserRole` làm ca kiểm NHẦM nhánh
 * mà vẫn xanh (bài học `test-noise-anchor-hides-a-branch`).
 */

const ACTOR = {
  id: "11111111-1111-4111-8111-111111111111",
  companyId: "22222222-2222-4222-8222-222222222222",
};
const TARGET = "33333333-3333-4333-8333-333333333333";
const ROLE_ID = "44444444-4444-4444-8444-444444444444";
const FOUR_KEYS = ["companyId", "expiresAt", "roleId", "userId"];

/** Hàng user_roles như repo trả (drizzle $inferSelect) — sentinel điều khiển được từng ca. */
interface UserRoleRow {
  id: string;
  userId: string;
  roleId: string;
  companyId: string;
  grantedBy: string | null;
  expiresAt: Date | null;
  createdAt: Date;
  deletedAt: Date | null;
  deletedBy: string | null;
}

function row(overrides: Partial<UserRoleRow> & Pick<UserRoleRow, "id">): UserRoleRow {
  return {
    userId: TARGET,
    roleId: ROLE_ID,
    companyId: ACTOR.companyId,
    grantedBy: null,
    expiresAt: null,
    createdAt: new Date("2026-08-24T00:00:00Z"),
    deletedAt: null,
    deletedBy: null,
    ...overrides,
  };
}

function makeService(opts: { existing?: UserRoleRow; inserted?: UserRoleRow }) {
  const repo = {
    findAssignableRole: vi.fn(async () => ({ id: ROLE_ID })),
    findUserInTenant: vi.fn(async () => ({ id: TARGET })),
    findUserRole: vi.fn(async () => opts.existing),
    insertUserRole: vi.fn(async () => opts.inserted),
    deleteUserRole: vi.fn(async () => opts.existing?.id),
  } as unknown as PermissionAdminRepository;
  const db = {
    withTenant: vi.fn(async (_companyId: string, fn: (tx: unknown) => Promise<unknown>) => fn({})),
  } as unknown as DatabaseService;
  const permissionService = {
    can: vi.fn(async () => ({ allow: true })),
  } as unknown as PermissionService;
  const audit = { record: vi.fn(async () => undefined) } as unknown as AuditService;
  const outbox = { enqueue: vi.fn(async () => undefined) } as unknown as OutboxService;
  const securityEvents = { record: vi.fn(async () => undefined) } as unknown as SecurityEventWriter;

  const svc = new PermissionAdminService(
    db,
    permissionService,
    audit,
    outbox,
    repo,
    securityEvents,
  );
  return { svc, repo };
}

describe("KI-073 · D2 — thân assignRole đồng nhất 4 khoá, echo request", () => {
  it("U1 — nhánh NO-OP: hàng gốc mang sentinel riêng, thân vẫn đúng 4 khoá echo request", async () => {
    // Sentinel U1: id/grantedBy/createdAt khác hẳn request — nếu bất kỳ giá trị nào lọt ra là bắt được.
    const existing = row({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      grantedBy: "99999999-9999-4999-8999-999999999999",
      createdAt: new Date("2026-01-05T07:00:00Z"),
      expiresAt: null,
    });
    const { svc, repo } = makeService({ existing });

    const res = await svc.assignRole(ACTOR, TARGET, { roleId: ROLE_ID });

    // Điều kiện tồn tại của ca: PHẢI là nhánh no-op (sameExpiry(null,null)) — không insert, không delete.
    expect(vi.mocked(repo.insertUserRole)).not.toHaveBeenCalled();
    expect(vi.mocked(repo.deleteUserRole)).not.toHaveBeenCalled();

    expect(Object.keys(res as object).sort()).toEqual(FOUR_KEYS);
    const body = res as unknown as Record<string, unknown>;
    expect(body.userId).toBe(TARGET);
    expect(body.roleId).toBe(ROLE_ID);
    expect(body.companyId).toBe(ACTOR.companyId);
    expect(body.expiresAt).toBeNull();
  });

  it("U2 — nhánh FRESH: hàng inserted mang sentinel KHÁC U1, thân CÙNG tập khoá cùng giá trị", async () => {
    const inserted = row({
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      grantedBy: ACTOR.id,
      createdAt: new Date("2026-08-24T09:30:00Z"),
      expiresAt: null,
    });
    const { svc, repo } = makeService({ existing: undefined, inserted });

    const res = await svc.assignRole(ACTOR, TARGET, { roleId: ROLE_ID });

    // Điều kiện tồn tại: nhánh fresh THẬT — có insert, không delete.
    expect(vi.mocked(repo.insertUserRole)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(repo.deleteUserRole)).not.toHaveBeenCalled();

    expect(Object.keys(res as object).sort()).toEqual(FOUR_KEYS);
    const body = res as unknown as Record<string, unknown>;
    expect(body.userId).toBe(TARGET);
    expect(body.roleId).toBe(ROLE_ID);
    expect(body.companyId).toBe(ACTOR.companyId);
    expect(body.expiresAt).toBeNull();
  });

  it("U3 — nhánh REASSIGN (đổi expiry): thân cùng tập khoá, expiresAt = giá trị REQUEST (ISO)", async () => {
    const requestExpiry = "2026-12-31T00:00:00.000Z";
    // Sentinel U3: existing có expiry KHÁC request (kích hoạt reassign), inserted mang expiry mới.
    const existing = row({
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      grantedBy: "88888888-8888-4888-8888-888888888888",
      createdAt: new Date("2026-03-15T00:00:00Z"),
      expiresAt: new Date("2026-09-01T00:00:00Z"),
    });
    const inserted = row({
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      grantedBy: ACTOR.id,
      createdAt: new Date("2026-08-24T10:00:00Z"),
      expiresAt: new Date(requestExpiry),
    });
    const { svc, repo } = makeService({ existing, inserted });

    const res = await svc.assignRole(ACTOR, TARGET, {
      roleId: ROLE_ID,
      expiresAt: requestExpiry,
    });

    // Điều kiện tồn tại: reassign THẬT — soft-delete hàng cũ rồi insert hàng mới.
    expect(vi.mocked(repo.deleteUserRole)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(repo.insertUserRole)).toHaveBeenCalledTimes(1);

    expect(Object.keys(res as object).sort()).toEqual(FOUR_KEYS);
    const body = res as unknown as Record<string, unknown>;
    // D2 ghim serialization: echo INSTANT của request dạng ISO — không phải Date của hàng DB.
    expect(body.expiresAt).toBe(requestExpiry);
    expect(body.userId).toBe(TARGET);
    expect(body.roleId).toBe(ROLE_ID);
    expect(body.companyId).toBe(ACTOR.companyId);
  });
});
