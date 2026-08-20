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

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * S10-AUTH-STEPUP-1 (APPEND-only) — hai đường TOTP phải TÁCH HẲN nhau.
 *
 * `verifyChallenge` (bước 2 LOGIN) làm hai việc mà đường step-up TUYỆT ĐỐI không được làm
 * (DECISIONS-09 §6 điểm 2, D1/D2):
 *   · claim replay bằng marker `totp-step` — dùng chung marker ⇒ mã vừa đăng nhập bị coi là SAI khi
 *     step-up trong cùng time-step 30s (và ngược lại): nguồn flake chắc chắn;
 *   · mã TOTP sai thì rơi xuống `UPDATE user_recovery_codes SET used_at` — nghĩa là một lượt step-up
 *     gõ sai có thể ĐỐT mã khôi phục của người dùng.
 * Khối dưới đóng đinh CẢ HAI vế: hành vi cũ giữ nguyên từng bước, method mới không chạm cái nào.
 * ═════════════════════════════════════════════════════════════════════════════════════════════ */

interface VerifyTxCalls {
  recoveryUpdates: number;
}

/** tx giả cho ĐƯỜNG VERIFY: select user_totp + update user_recovery_codes (đếm để chứng minh D2). */
function makeVerifyTx(opts: {
  totpRow?: Record<string, unknown> | null;
  consumed?: { id: string }[];
}): {
  tx: unknown;
  calls: VerifyTxCalls;
} {
  const calls: VerifyTxCalls = { recoveryUpdates: 0 };
  const row =
    opts.totpRow === undefined ? { enabledAt: new Date(), secretCiphertext: "c" } : opts.totpRow;
  const tx = {
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          limit: () => Promise.resolve(table === userTotp && row ? [row] : []),
        }),
      }),
    }),
    update: (table: unknown) => ({
      set: () => ({
        where: () => ({
          returning: () => {
            if (table === userRecoveryCodes) calls.recoveryUpdates += 1;
            return Promise.resolve(opts.consumed ?? []);
          },
        }),
      }),
    }),
  };
  return { tx, calls };
}

function makeVerifySvc(tx: unknown, opts: { totpOk?: boolean; firstUse?: boolean }) {
  const dbsvc = {
    withTenant: vi.fn(async (_cid: string, fn: (t: unknown) => Promise<unknown>) => fn(tx)),
  };
  const secrets = { decryptSecret: vi.fn(async () => "PLAIN-SECRET-NOT-LOGGED") };
  const totp = { verify: vi.fn(() => opts.totpOk ?? true), currentStep: vi.fn(() => 1_800_000) };
  const tokens = { hashToken: vi.fn(() => "hash-of-code") };
  const audit = { record: vi.fn(async (_tx: unknown, _entry: unknown) => undefined) };
  const rateLimiter = {};
  const replayGuard = {
    claim: vi.fn(async (_marker: string, _rest: string, _ttlSec?: number) => opts.firstUse ?? true),
  };
  const securityEvents = { record: vi.fn(async () => undefined) };
  const svc = new TwoFactorService(
    dbsvc as never,
    secrets as never,
    totp as never,
    tokens as never,
    audit as never,
    rateLimiter as never,
    replayGuard as never,
    securityEvents as never,
  );
  return { svc, audit, replayGuard, totp, dbsvc };
}

describe("TwoFactorService.verifyChallenge — HỒI QUY: giữ nguyên từng hành vi (spec 2FA cũ)", () => {
  it("TOTP đúng ⇒ true, claim marker LOGIN 'totp-step', audit 'auth.2fa_verified'", async () => {
    const { tx, calls } = makeVerifyTx({});
    const { svc, audit, replayGuard } = makeVerifySvc(tx, { totpOk: true });
    expect(await svc.verifyChallenge(USER_ID, COMPANY_ID, "123456")).toBe(true);
    expect(replayGuard.claim.mock.calls[0]?.[0]).toBe("totp-step");
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ action: "auth.2fa_verified" }),
    );
    expect(calls.recoveryUpdates).toBe(0); // TOTP đúng thì không chạm recovery
  });

  it("TOTP sai + recovery code khớp ⇒ true, CÓ tiêu recovery code (hành vi cũ, KHÔNG đổi)", async () => {
    const { tx, calls } = makeVerifyTx({ consumed: [{ id: "r1" }] });
    const { svc, audit } = makeVerifySvc(tx, { totpOk: false });
    expect(await svc.verifyChallenge(USER_ID, COMPANY_ID, "recovery-code")).toBe(true);
    expect(calls.recoveryUpdates).toBe(1);
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ action: "auth.2fa_recovery_used" }),
    );
  });

  it("TOTP đúng nhưng marker ĐÃ tiêu ⇒ false + audit 'auth.2fa_step_replay_rejected'", async () => {
    const { tx } = makeVerifyTx({});
    const { svc, audit } = makeVerifySvc(tx, { totpOk: true, firstUse: false });
    expect(await svc.verifyChallenge(USER_ID, COMPANY_ID, "123456")).toBe(false);
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ action: "auth.2fa_step_replay_rejected" }),
    );
  });
});

describe("TwoFactorService.verifyTotpForStepUp — D1/D2: TOTP THUẦN, marker RIÊNG, 0 recovery", () => {
  it("mã đúng ⇒ 'ok' và claim marker 'stepup-totp' (KHÁC 'totp-step' của login)", async () => {
    const { tx, calls } = makeVerifyTx({});
    const { svc, replayGuard } = makeVerifySvc(tx, { totpOk: true });
    expect(await svc.verifyTotpForStepUp(USER_ID, COMPANY_ID, "123456")).toBe("ok");
    expect(replayGuard.claim).toHaveBeenCalledTimes(1);
    expect(replayGuard.claim.mock.calls[0]?.[0]).toBe("stepup-totp");
    expect(replayGuard.claim.mock.calls[0]?.[0]).not.toBe("totp-step");
    expect(calls.recoveryUpdates).toBe(0);
  });

  it("D2: mã SAI ⇒ 'invalid-code' và KHÔNG chạm user_recovery_codes (0 update)", async () => {
    const { tx, calls } = makeVerifyTx({ consumed: [{ id: "r1" }] });
    const { svc } = makeVerifySvc(tx, { totpOk: false });
    expect(await svc.verifyTotpForStepUp(USER_ID, COMPANY_ID, "000000")).toBe("invalid-code");
    // Cùng fixture đó, verifyChallenge SẼ tiêu một mã (ca ở khối trên) — đây là điểm khác biệt.
    expect(calls.recoveryUpdates).toBe(0);
  });

  it("chưa enroll (không có hàng user_totp) ⇒ 'not-enrolled', KHÔNG verify, KHÔNG claim", async () => {
    const { tx } = makeVerifyTx({ totpRow: null });
    const { svc, replayGuard, totp } = makeVerifySvc(tx, { totpOk: true });
    expect(await svc.verifyTotpForStepUp(USER_ID, COMPANY_ID, "123456")).toBe("not-enrolled");
    expect(totp.verify).not.toHaveBeenCalled();
    expect(replayGuard.claim).not.toHaveBeenCalled();
  });

  it("có hàng nhưng enabled_at NULL (enroll dở) ⇒ 'not-enrolled'", async () => {
    const { tx } = makeVerifyTx({ totpRow: { enabledAt: null } });
    const { svc } = makeVerifySvc(tx, { totpOk: true });
    expect(await svc.verifyTotpForStepUp(USER_ID, COMPANY_ID, "123456")).toBe("not-enrolled");
  });

  it("mã đúng nhưng marker step-up ĐÃ tiêu ⇒ 'invalid-code' (không có oracle riêng cho replay)", async () => {
    const { tx, calls } = makeVerifyTx({});
    const { svc } = makeVerifySvc(tx, { totpOk: true, firstUse: false });
    expect(await svc.verifyTotpForStepUp(USER_ID, COMPANY_ID, "123456")).toBe("invalid-code");
    expect(calls.recoveryUpdates).toBe(0);
  });

  it("BẤT BIẾN #1: đọc user_totp trong withTenant với companyId truyền vào", async () => {
    const { tx } = makeVerifyTx({});
    const { svc, dbsvc } = makeVerifySvc(tx, { totpOk: true });
    await svc.verifyTotpForStepUp(USER_ID, COMPANY_ID, "123456");
    expect(dbsvc.withTenant.mock.calls[0]?.[0]).toBe(COMPANY_ID);
  });
});
