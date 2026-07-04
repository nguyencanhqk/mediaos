import { ConflictException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { Column, SQL } from "drizzle-orm";
import { TwoFactorService, TWO_FACTOR_ENFORCED } from "./two-factor.service";
import { userRecoveryCodes, userRoles, users, userTotp } from "../db/schema";

/**
 * S2-AUTH-DB-3 Lane C — RED-first (kiểm chứng CẤU TRÚC WHERE, không cần Postgres). Reader `user_roles`
 * ngoài permission-engine PHẢI lọc `isNull(userRoles.deletedAt)` (assignment soft-deleted = hết hiệu lực).
 * Duyệt `queryChunks` đệ quy tìm Column `deleted_at` THUỘC ĐÚNG bảng — phân biệt userRoles.deleted_at với
 * roles.deleted_at (reader CŨ chỉ lọc roles ⇒ RED; sau fix lọc CẢ HAI ⇒ GREEN).
 */
function whereFiltersSoftDelete(where: unknown, table: unknown): boolean {
  let found = false;
  const walk = (node: unknown): void => {
    if (node instanceof Column) {
      if (node.table === table && node.name === "deleted_at") found = true;
      return;
    }
    if (node instanceof SQL) {
      for (const chunk of node.queryChunks) walk(chunk);
      return;
    }
    if (Array.isArray(node)) for (const item of node) walk(item);
  };
  walk(where);
  return found;
}

/**
 * S2-AUTH-BE-11 (l2-2fa-enforce-disable, CROWN auth — RED viết TRƯỚC theo §5.5 / gate-6).
 *
 * Hai nhánh MỚI (fail-closed) được chứng minh KHÔNG cần Postgres (mock withTenant + tx như
 * auth-status-guard.spec.ts):
 *   (1) requiresTwoFactorTx = roles.requires_two_factor (mig 0120) OR users.require_two_factor (mig 0466),
 *       đọc trong CÙNG tx. Nguồn PER-USER-only (role KHÔNG cờ) PHẢI ⇒ true (RED trên code cũ chỉ đọc role).
 *   (2) disable() khi bị ép (requiresTwoFactorTx=true) ⇒ ConflictException code=TWO_FACTOR_ENFORCED
 *       TRƯỚC mọi delete/audit/security-event: KHÔNG xoá user_totp/user_recovery_codes, KHÔNG audit
 *       'auth.2fa_disabled', KHÔNG ghi security-event TOTP_DISABLED, KHÔNG revoke.
 *
 * Wiring BE-8 (audit + TOTP_DISABLED chỉ khi disable THÀNH CÔNG) GIỮ nguyên — regression ở đây.
 */

interface TxCalls {
  totpDeletes: number;
  recoveryDeletes: number;
}

/**
 * tx giả: phục vụ chuỗi drizzle builder cho requiresTwoFactorTx (select users; select userRoles⋈roles)
 * và disable (delete userTotp .returning; delete userRecoveryCodes). Trả theo BẢNG. Đếm số lần delete để
 * chứng minh fail-closed KHÔNG chạm bảng khi bị ép.
 */
function makeTx(opts: {
  /** users.require_two_factor (mig 0466 — nguồn PER-USER). */
  userRequireTwoFactor?: boolean;
  /** user giữ ÍT NHẤT 1 role còn hiệu lực có requires_two_factor (mig 0120 — nguồn ROLE). */
  hasEnforcedRole?: boolean;
  /** hàng user_totp bị xoá (disable): [{id}] = đang bật ⇒ audit+TOTP_DISABLED; [] = chưa bật ⇒ không. */
  deletedTotp?: { id: string }[];
}): { tx: unknown; calls: TxCalls; captures: { userRolesWhere?: unknown } } {
  const calls: TxCalls = { totpDeletes: 0, recoveryDeletes: 0 };
  // S2-AUTH-DB-3 Lane C: bắt WHERE của reader user_roles để assert lọc soft-delete (không cần DB).
  const captures: { userRolesWhere?: unknown } = {};
  const tx = {
    select: (_cols?: unknown) => ({
      from: (table: unknown) => {
        const rowsFor = () => {
          if (table === users) return [{ requireTwoFactor: opts.userRequireTwoFactor ?? false }];
          if (table === userRoles) return opts.hasEnforcedRole ? [{ one: 1 }] : [];
          return [];
        };
        const limitChain = { limit: () => Promise.resolve(rowsFor()) };
        const whereChain = {
          where: (cond?: unknown) => {
            if (table === userRoles) captures.userRolesWhere = cond;
            return limitChain;
          },
        };
        // userRoles path: .from(userRoles).innerJoin(roles).where().limit()
        return { ...whereChain, innerJoin: () => whereChain };
      },
    }),
    delete: (table: unknown) => ({
      where: () => {
        if (table === userTotp) {
          return {
            returning: () => {
              calls.totpDeletes += 1;
              return Promise.resolve(opts.deletedTotp ?? []);
            },
          };
        }
        if (table === userRecoveryCodes) {
          calls.recoveryDeletes += 1;
          return Promise.resolve(undefined);
        }
        return Promise.resolve(undefined);
      },
    }),
  };
  return { tx, calls, captures };
}

function makeSvc(tx: unknown) {
  const dbsvc = {
    withTenant: vi.fn(async (_cid: string, fn: (t: unknown) => Promise<unknown>) => fn(tx)),
  };
  const audit = { record: vi.fn(async () => undefined) };
  const securityEvents = { record: vi.fn(async () => undefined) };
  const svc = new TwoFactorService(
    dbsvc as never, // dbsvc
    {} as never, // secrets
    {} as never, // totp
    {} as never, // tokens
    audit as never, // audit
    {} as never, // rateLimiter
    {} as never, // replayGuard
    securityEvents as never, // securityEvents (S2-AUTH-BE-8 dual-write)
  );
  return { svc, audit, securityEvents };
}

const COMPANY_ID = "22222222-2222-2222-2222-222222222222";
const USER_ID = "33333333-3333-3333-3333-333333333333";

// ── requiresTwoFactorTx: role-flag OR users.require_two_factor (đọc CÙNG tx) ────────────────────
describe("TwoFactorService.requiresTwoFactorTx — role OR per-user (mig 0466)", () => {
  it("PER-USER only (users.require_two_factor=true, role KHÔNG cờ) → true", async () => {
    const { tx } = makeTx({ userRequireTwoFactor: true, hasEnforcedRole: false });
    const { svc } = makeSvc(tx);
    expect(await svc.requiresTwoFactorTx(tx as never, USER_ID)).toBe(true);
  });

  it("ROLE only (per-user=false, role có requires_two_factor) → true (regression mig 0120)", async () => {
    const { tx } = makeTx({ userRequireTwoFactor: false, hasEnforcedRole: true });
    const { svc } = makeSvc(tx);
    expect(await svc.requiresTwoFactorTx(tx as never, USER_ID)).toBe(true);
  });

  it("KHÔNG nguồn nào (per-user=false + role không cờ) → false", async () => {
    const { tx } = makeTx({ userRequireTwoFactor: false, hasEnforcedRole: false });
    const { svc } = makeSvc(tx);
    expect(await svc.requiresTwoFactorTx(tx as never, USER_ID)).toBe(false);
  });
});

// ── S2-AUTH-DB-3 Lane C: reader user_roles PHẢI lọc soft-delete assignment (isNull(userRoles.deletedAt)) ─
describe("TwoFactorService.requiresTwoFactorTx — lọc soft-delete user_roles (S2-AUTH-DB-3 Lane C)", () => {
  it("WHERE nhánh role có isNull(userRoles.deletedAt) — RED nếu chỉ lọc roles.deletedAt", async () => {
    // per-user=false ⇒ đi tiếp xuống nhánh ROLE (chạm query user_roles); role-không-cờ giữ nhánh trung tính.
    const { tx, captures } = makeTx({ userRequireTwoFactor: false, hasEnforcedRole: false });
    const { svc } = makeSvc(tx);
    await svc.requiresTwoFactorTx(tx as never, USER_ID);
    expect(captures.userRolesWhere).toBeDefined();
    expect(whereFiltersSoftDelete(captures.userRolesWhere, userRoles)).toBe(true);
  });
});

// ── disable() fail-closed: bị ép → 409 TWO_FACTOR_ENFORCED TRƯỚC delete/audit/security-event ─────
describe("TwoFactorService.disable — fail-closed khi bị ép 2FA", () => {
  it("ép QUA PER-USER (users.require_two_factor) → ConflictException code=TWO_FACTOR_ENFORCED, 0 delete/audit/event", async () => {
    const { tx, calls } = makeTx({ userRequireTwoFactor: true, deletedTotp: [{ id: "x" }] });
    const { svc, audit, securityEvents } = makeSvc(tx);
    const err = await svc.disable(USER_ID, COMPANY_ID).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).getStatus()).toBe(409);
    expect((err as ConflictException).getResponse()).toMatchObject({ code: TWO_FACTOR_ENFORCED });
    // KHÔNG chạm bảng, KHÔNG audit, KHÔNG security-event (fail-closed TRƯỚC mọi side-effect).
    expect(calls.totpDeletes).toBe(0);
    expect(calls.recoveryDeletes).toBe(0);
    expect(audit.record).not.toHaveBeenCalled();
    expect(securityEvents.record).not.toHaveBeenCalled();
  });

  it("ép QUA ROLE (roles.requires_two_factor) → 409 TWO_FACTOR_ENFORCED, 0 delete/audit/event", async () => {
    const { tx, calls } = makeTx({ hasEnforcedRole: true, deletedTotp: [{ id: "x" }] });
    const { svc, audit, securityEvents } = makeSvc(tx);
    const err = await svc.disable(USER_ID, COMPANY_ID).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).getResponse()).toMatchObject({ code: TWO_FACTOR_ENFORCED });
    expect(calls.totpDeletes).toBe(0);
    expect(audit.record).not.toHaveBeenCalled();
    expect(securityEvents.record).not.toHaveBeenCalled();
  });

  it("KHÔNG bị ép + đang bật → xoá secret+recovery, audit 'auth.2fa_disabled' + TOTP_DISABLED (regression BE-8)", async () => {
    const { tx, calls } = makeTx({ deletedTotp: [{ id: "x" }] }); // không ép, có bản ghi bị xoá
    const { svc, audit, securityEvents } = makeSvc(tx);
    await svc.disable(USER_ID, COMPANY_ID);
    expect(calls.totpDeletes).toBe(1);
    expect(calls.recoveryDeletes).toBe(1);
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ action: "auth.2fa_disabled", objectType: "auth" }),
    );
    expect(securityEvents.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ eventType: "TOTP_DISABLED", userId: USER_ID }),
    );
  });

  it("KHÔNG bị ép + CHƯA bật (0 hàng bị xoá) → KHÔNG audit/TOTP_DISABLED (regression BE-8)", async () => {
    const { tx, calls } = makeTx({ deletedTotp: [] }); // không ép, không có bản ghi bị xoá
    const { svc, audit, securityEvents } = makeSvc(tx);
    await svc.disable(USER_ID, COMPANY_ID);
    expect(calls.totpDeletes).toBe(1); // vẫn thử xoá (idempotent)
    expect(audit.record).not.toHaveBeenCalled();
    expect(securityEvents.record).not.toHaveBeenCalled();
  });
});

// ── hằng số machine-code (mirror TWO_FACTOR_SETUP_REQUIRED của enforcement guard) ────────────────
describe("TWO_FACTOR_ENFORCED constant", () => {
  it("là hằng số ổn định = 'TWO_FACTOR_ENFORCED' (FE map machine-code, KHÔNG hard-code message)", () => {
    expect(TWO_FACTOR_ENFORCED).toBe("TWO_FACTOR_ENFORCED");
  });
});
