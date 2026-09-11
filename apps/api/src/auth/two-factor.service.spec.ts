import {
  ConflictException,
  HttpException,
  HttpStatus,
  UnauthorizedException,
} from "@nestjs/common";
import { rlKey as rateLimitKey } from "../common/valkey/valkey-key";
import { TOO_MANY_REQUESTS_MESSAGE } from "../common/filters/retry-after";
import { describe, expect, it, vi } from "vitest";
import { Column, SQL } from "drizzle-orm";
import { TwoFactorService, TWO_FACTOR_ENFORCED } from "./two-factor.service";
import { userRecoveryCodes, userRoles, users, userTotp } from "../db/schema";
import { withExpectedLoggerErrors } from "../../test/helpers/expect-logged-errors";

/**
 * S2-AUTH-DB-3 Lane C — RED-first (kiểm chứng CẤU TRÚC WHERE, không cần Postgres). Reader `user_roles`
 * ngoài permission-engine PHẢI lọc `isNull(userRoles.deletedAt)` (assignment soft-deleted = hết hiệu lực).
 * Duyệt `queryChunks` đệ quy tìm Column `deleted_at` THUỘC ĐÚNG bảng — phân biệt userRoles.deleted_at với
 * roles.deleted_at (reader CŨ chỉ lọc roles ⇒ RED; sau fix lọc CẢ HAI ⇒ GREEN).
 */
function whereHasColumn(where: unknown, table: unknown, column: string): boolean {
  let found = false;
  const walk = (node: unknown): void => {
    if (node instanceof Column) {
      if (node.table === table && node.name === column) found = true;
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

function whereFiltersSoftDelete(where: unknown, table: unknown): boolean {
  return whereHasColumn(where, table, "deleted_at");
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

interface TxCaptures {
  userRolesWhere?: unknown;
  /** WHERE của câu `DELETE FROM user_totp` gần nhất (D2 — §d2-*-shape). */
  totpDeleteWhere?: unknown;
  /** WHERE của câu `DELETE FROM user_recovery_codes` gần nhất (D2). */
  recoveryDeleteWhere?: unknown;
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
  /**
   * S18-AUTH-2FADELETED-1 — `users.deleted_at` của hàng đọc được. `disable()` đọc bảng `users` HAI
   * lần (requiresTwoFactorTx `:96-100`, rồi vế `alive` mới) mà mock này dispatch CHỈ theo bảng ⇒ một
   * hàng phải mang CẢ HAI cột. Bỏ qua tham số này thì `deletedAt === undefined` ⇒ cổng mới luôn cho
   * qua và ca test xanh vì lý do SAI (`same-builder-twice-makes-unit-spec-vacuous`).
   */
  userDeletedAt?: Date | null;
  /** Hàng `users` KHÔNG nhìn thấy được (RLS ẩn — đường cross-tenant của `disable()`). */
  userMissing?: boolean;
}): { tx: unknown; calls: TxCalls; captures: TxCaptures } {
  const calls: TxCalls = { totpDeletes: 0, recoveryDeletes: 0 };
  // S2-AUTH-DB-3 Lane C: bắt WHERE của reader user_roles để assert lọc soft-delete (không cần DB).
  const captures: TxCaptures = {};
  const tx = {
    select: (_cols?: unknown) => ({
      from: (table: unknown) => {
        const rowsFor = () => {
          if (table === users) {
            // Một hàng mang CẢ HAI cột — xem ghi chú `userDeletedAt` ở khai báo opts.
            if (opts.userMissing) return [];
            return [
              {
                requireTwoFactor: opts.userRequireTwoFactor ?? false,
                deletedAt: opts.userDeletedAt ?? null,
              },
            ];
          }
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
    // S18-AUTH-RESTORE2FA-1 (D2) — `where` giờ NHẬN và GIỮ đối số. Trước WO này nó là `where: ()`
    // KHÔNG tham số ⇒ mock này bắt được 0/4 câu DELETE, và một đột biến "gỡ `company_id`" đi qua
    // toàn bộ suite unit mà không ai đỏ. HAI hình dạng khác nhau phải giữ nguyên: `userTotp` đi
    // tiếp `.returning()`, còn `userRecoveryCodes` trả THẲNG Promise.
    delete: (table: unknown) => ({
      where: (cond?: unknown) => {
        if (table === userTotp) {
          captures.totpDeleteWhere = cond;
          return {
            returning: () => {
              calls.totpDeletes += 1;
              return Promise.resolve(opts.deletedTotp ?? []);
            },
          };
        }
        if (table === userRecoveryCodes) {
          captures.recoveryDeleteWhere = cond;
          calls.recoveryDeletes += 1;
          return Promise.resolve(undefined);
        }
        return Promise.resolve(undefined);
      },
    }),
    // `enroll` ghi hai bảng; mock này chỉ cần nuốt giá trị (hình dạng WHERE của INSERT không tồn tại).
    insert: (_table: unknown) => ({
      values: (_vals: unknown) => Promise.resolve(undefined),
    }),
  };
  return { tx, calls, captures };
}

/**
 * Mock `LoginRateLimiter` dựng TỪ SỐ 0 — trước S18-AUTH-RETRYAFTER-1 hai chỗ dùng `{}` rỗng, nghĩa là
 * nhánh 429 của `confirmEnable` (`two-factor.service.ts:194`) CHƯA TỪNG chạy trong file spec này: gọi
 * `isLocked` trên object rỗng ném TypeError chứ không cho ra 429. Ba method dưới đây là toàn bộ bề mặt
 * `two-factor.service.ts` chạm tới (`grep "rateLimiter\." two-factor.service.ts`) — cộng `remainingLockSec`
 * mà nhánh 429 mới đọc để lấy số giây còn khoá.
 */
function makeRateLimiterMock(opts: { locked?: boolean; remainingSec?: number | null } = {}) {
  return {
    isLocked: vi.fn(async () => opts.locked ?? false),
    remainingLockSecOrNull: vi.fn(async () => opts.remainingSec ?? null),
    recordFailure: vi.fn(async () => undefined),
    reset: vi.fn(async () => undefined),
  };
}

function makeSvc(tx: unknown) {
  const dbsvc = {
    withTenant: vi.fn(async (_cid: string, fn: (t: unknown) => Promise<unknown>) => fn(tx)),
  };
  const audit = { record: vi.fn(async () => undefined) };
  const securityEvents = { record: vi.fn(async () => undefined) };
  const rateLimiter = makeRateLimiterMock();
  const svc = new TwoFactorService(
    dbsvc as never, // dbsvc
    {} as never, // secrets
    {} as never, // totp
    {} as never, // tokens
    audit as never, // audit
    rateLimiter as never, // rateLimiter
    {} as never, // replayGuard
    securityEvents as never, // securityEvents (S2-AUTH-BE-8 dual-write)
  );
  // `dbsvc` phơi ra để `§a2-pos-delegate` đo được rằng đường controller ĐI QUA `withTenant` với đúng
  // companyId — không chỉ trả đúng giá trị (thêm trường, không đổi trường cũ).
  return { svc, audit, securityEvents, rateLimiter, dbsvc };
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
    const err = await svc.disable(USER_ID, COMPANY_ID, {}).catch((e) => e);
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
    const err = await svc.disable(USER_ID, COMPANY_ID, {}).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).getResponse()).toMatchObject({ code: TWO_FACTOR_ENFORCED });
    expect(calls.totpDeletes).toBe(0);
    expect(audit.record).not.toHaveBeenCalled();
    expect(securityEvents.record).not.toHaveBeenCalled();
  });

  it("KHÔNG bị ép + đang bật → xoá secret+recovery, audit 'auth.2fa_disabled' + TOTP_DISABLED (regression BE-8)", async () => {
    const { tx, calls } = makeTx({ deletedTotp: [{ id: "x" }] }); // không ép, có bản ghi bị xoá
    const { svc, audit, securityEvents } = makeSvc(tx);
    await svc.disable(USER_ID, COMPANY_ID, {});
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
    await svc.disable(USER_ID, COMPANY_ID, {});
    expect(calls.totpDeletes).toBe(1); // vẫn thử xoá (idempotent)
    expect(audit.record).not.toHaveBeenCalled();
    expect(securityEvents.record).not.toHaveBeenCalled();
  });
});

/**
 * S18-AUTH-2FADELETED-1 (vế L2) — lệnh GHI không được nằm NGOÀI phép kiểm.
 *
 * `AuthService.disableTwoFactor` re-auth trong tx của NÓ rồi gọi `disable()`, hàm này mở tx RIÊNG.
 * Vế `deleted_at` ở câu SELECT re-auth KHÔNG bảo vệ được một câu ghi ở tx khác: một `soft-delete`
 * commit XEN GIỮA hai tx vẫn hard-delete được `user_totp` + `user_recovery_codes` của hàng đã xoá.
 * Đây là ca cô lập vế L2 — nó gọi THẲNG `disable()`, nên vế L1 không tồn tại trong đường đi (cổng
 * chồng nhau phải đột biến TỪNG VẾ — `overdetermined-gate-makes-deny-spec-vacuous`).
 */
describe("TwoFactorService.disable — hàng đã XOÁ MỀM (S18-AUTH-2FADELETED-1)", () => {
  it("§inner-unit: hàng thấy được + deleted_at != null ⇒ NÉM 401, KHÔNG xoá totp/recovery", async () => {
    const { tx, calls } = makeTx({ userDeletedAt: new Date(), deletedTotp: [{ id: "x" }] });
    const { svc, audit, securityEvents } = makeSvc(tx);

    await expect(svc.disable(USER_ID, COMPANY_ID, {})).rejects.toBeInstanceOf(
      UnauthorizedException,
    );

    // Lệnh ghi KHÔNG chạy — đây là điều WO này mua được.
    expect(calls.totpDeletes).toBe(0);
    expect(calls.recoveryDeletes).toBe(0);
    // Vết BỀN cho nhánh từ chối (ghi TRONG tx, ném NGOÀI tx ⇒ tx commit giữ được vết).
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ action: "auth.2fa_disable_denied", objectType: "auth" }),
    );
    // KHÔNG được đẻ TOTP_DISABLED cho một lần KHÔNG tắt.
    expect(securityEvents.record).not.toHaveBeenCalled();
  });

  /**
   * §inner-notvisible — hàng KHÔNG nhìn thấy được (RLS ẩn) là đường CROSS-TENANT, và hợp đồng hiện
   * hành ghim nó là **no-op im lặng**: `two-factor.int-spec.ts` ca (f) gọi `disable(userOfC, D.companyId)`
   * và đòi KHÔNG ném. Biến nhánh này thành 401 sẽ làm ĐỎ ca đó, và tệ hơn: ghi một hàng audit
   * append-only gán `company_id = D` cho `actor_user_id = user của C` (`audit_logs.actor_user_id` FK
   * về `users(id)`, KHÔNG composite tenant — `0003_audit_outbox.sql:9-11`).
   *
   * Không phải fail-open: hôm nay nhánh này ĐÃ là no-op (delete khớp 0 hàng do RLS), bản vá không nới
   * thêm gì. Phép kiểm thật nằm ở vế L1, nơi `companyId` luôn là của chính người gọi.
   */
  it("§inner-notvisible: hàng KHÔNG thấy (cross-tenant/RLS) ⇒ KHÔNG ném, KHÔNG audit (giữ hợp đồng)", async () => {
    const { tx, calls } = makeTx({ userMissing: true, deletedTotp: [] });
    const { svc, audit } = makeSvc(tx);

    await expect(svc.disable(USER_ID, COMPANY_ID, {})).resolves.toBeUndefined();

    expect(calls.totpDeletes).toBe(1); // vẫn chạy, RLS lọc còn 0 hàng — y như trước vá
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("§enforced-trước: 409 TWO_FACTOR_ENFORCED vẫn THẮNG vế mới (thứ tự cổng không đảo)", async () => {
    // Vừa bị ép, vừa đã xoá mềm: phải ra 409 (policy) chứ KHÔNG phải 401 — vế `alive` đứng SAU
    // `requiresTwoFactorTx`, không được chen lên trước.
    const { tx, calls } = makeTx({ userRequireTwoFactor: true, userDeletedAt: new Date() });
    const { svc } = makeSvc(tx);

    await expect(svc.disable(USER_ID, COMPANY_ID, {})).rejects.toBeInstanceOf(ConflictException);
    expect(calls.totpDeletes).toBe(0);
  });

  it("§inner-allow (đối chứng DƯƠNG): hàng sống vẫn tắt được — ca deny không xanh-RỖNG", async () => {
    const { tx, calls } = makeTx({ userDeletedAt: null, deletedTotp: [{ id: "x" }] });
    const { svc, audit, securityEvents } = makeSvc(tx);

    await expect(svc.disable(USER_ID, COMPANY_ID, {})).resolves.toBeUndefined();

    expect(calls.totpDeletes).toBe(1);
    expect(calls.recoveryDeletes).toBe(1);
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ action: "auth.2fa_disabled" }),
    );
    expect(securityEvents.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ eventType: "TOTP_DISABLED" }),
    );
  });

  /**
   * §audit-fail-closed — hôm nay fail-closed do CẤU TRÚC (không có try/catch quanh `withTenant`),
   * nhưng một quyết định 0 test ghim thì lần refactor sau — kiểu bọc `audit.record` trong try/catch
   * "cho an toàn" — sẽ lặng lẽ đổi nó: khi đó nhánh từ chối vẫn ném 401 mà KHÔNG còn vết nào.
   * Đối xứng ca đã có của `resetPassword` (`auth.service.spec.ts:1161`).
   */
  it("§audit-fail-closed: audit.record NÉM ⇒ lỗi trồi lên, KHÔNG nuốt thành 401 giả", async () => {
    const { tx } = makeTx({ userDeletedAt: new Date() });
    const { svc, audit } = makeSvc(tx);
    const boom = new Error("audit sink down");
    audit.record.mockRejectedValueOnce(boom);

    await expect(svc.disable(USER_ID, COMPANY_ID, {})).rejects.toBe(boom);
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

function makeVerifySvc(
  tx: unknown,
  opts: { totpOk?: boolean; firstUse?: boolean; locked?: boolean; remainingSec?: number | null },
) {
  const dbsvc = {
    withTenant: vi.fn(async (_cid: string, fn: (t: unknown) => Promise<unknown>) => fn(tx)),
  };
  const secrets = { decryptSecret: vi.fn(async () => "PLAIN-SECRET-NOT-LOGGED") };
  const totp = { verify: vi.fn(() => opts.totpOk ?? true), currentStep: vi.fn(() => 1_800_000) };
  const tokens = { hashToken: vi.fn(() => "hash-of-code") };
  const audit = { record: vi.fn(async (_tx: unknown, _entry: unknown) => undefined) };
  const rateLimiter = makeRateLimiterMock({
    locked: opts.locked,
    remainingSec: opts.remainingSec,
  });
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
  return { svc, audit, replayGuard, totp, dbsvc, rateLimiter };
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

// ── S18-AUTH-RETRYAFTER-1 — confirmEnable 429 mang retryAfterSec ────────────────────────────────
describe("TwoFactorService.confirmEnable — 429 mang retryAfterSec (S18-AUTH-RETRYAFTER-1)", () => {
  const RL_KEY = rateLimitKey("2fa-enable", `${COMPANY_ID}|${USER_ID}`);

  function payloadOf(err: unknown) {
    expect(err).toBeInstanceOf(HttpException);
    const e = err as HttpException;
    expect(e.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    expect(e.message).toBe(TOO_MANY_REQUESTS_MESSAGE);
    return e.getResponse() as { details?: Array<{ field: string; message: string }> };
  }

  it("đang khoá + TTL đọc được ⇒ 429 mang số giây, đọc bằng ĐÚNG khoá `2fa-enable`", async () => {
    const { tx } = makeVerifyTx({});
    const { svc, rateLimiter } = makeVerifySvc(tx, { locked: true, remainingSec: 540 });

    const err = await svc.confirmEnable(USER_ID, COMPANY_ID, "123456", {}).catch((e: unknown) => e);

    expect(payloadOf(err).details).toEqual([
      { field: "retryAfterSec", message: "540", rule: "retry-after" },
    ]);
    expect(rateLimiter.remainingLockSecOrNull).toHaveBeenCalledWith(RL_KEY);
  });

  it("đang khoá + TTL `null` (Valkey rớt) ⇒ VẪN 429, KHÔNG `details`", async () => {
    const { tx } = makeVerifyTx({});
    const { svc } = makeVerifySvc(tx, { locked: true, remainingSec: null });

    const err = await svc.confirmEnable(USER_ID, COMPANY_ID, "123456", {}).catch((e: unknown) => e);

    expect(payloadOf(err)).not.toHaveProperty("details");
  });

  it("KHÔNG khoá ⇒ KHÔNG đọc TTL (đường sạch không trả thêm giá)", async () => {
    const { tx } = makeVerifyTx({});
    const { svc, rateLimiter } = makeVerifySvc(tx, { locked: false, totpOk: true });

    await svc.confirmEnable(USER_ID, COMPANY_ID, "123456", {}).catch(() => undefined);

    expect(rateLimiter.remainingLockSecOrNull).not.toHaveBeenCalled();
  });
});

// ── S18-AUTH-RESTORE2FA-1 (D2) — BỐN câu DELETE mang `company_id` TƯỜNG MINH ───────────────────
//
// ⚠️ VÌ SAO ASSERT CÚ PHÁP, KHÔNG PHẢI HÀNH VI. Một ca int kiểu "`disable()` của A không đụng hàng
// của B khác tenant" KHÔNG THỂ ĐỎ: `uniqueIndex("user_totp_user_uq").on(t.userId)` là UNIQUE TOÀN
// BẢNG ⇒ `DELETE WHERE user_id = A` không bao giờ chạm hàng của B, có hay không `company_id`. Cổng
// rỗng. Vế duy nhất đo được là hình dạng WHERE — nên đo đúng nó.
//
// ⚠️ HAI HỌ TÁCH RIÊNG (`disable` vs `enroll`) vì chúng dùng HAI harness khác nhau. Gộp lại thì đột
// biến "gỡ `company_id` ở câu DELETE của `enroll`" không nói được nó đỏ ở đâu.
describe("TwoFactorService — D2: DELETE user_totp/user_recovery_codes có company_id tường minh", () => {
  describe("§d2-disable-shape — hai câu DELETE của disable()", () => {
    it("DELETE user_totp mang CẢ company_id LẪN user_id", async () => {
      const { tx, captures } = makeTx({ deletedTotp: [{ id: "t1" }] });
      const { svc } = makeSvc(tx);
      await svc.disable(USER_ID, COMPANY_ID, {});
      expect(whereHasColumn(captures.totpDeleteWhere, userTotp, "company_id")).toBe(true);
      expect(whereHasColumn(captures.totpDeleteWhere, userTotp, "user_id")).toBe(true);
    });

    it("DELETE user_recovery_codes mang CẢ company_id LẪN user_id", async () => {
      const { tx, captures } = makeTx({ deletedTotp: [{ id: "t1" }] });
      const { svc } = makeSvc(tx);
      await svc.disable(USER_ID, COMPANY_ID, {});
      expect(whereHasColumn(captures.recoveryDeleteWhere, userRecoveryCodes, "company_id")).toBe(
        true,
      );
      expect(whereHasColumn(captures.recoveryDeleteWhere, userRecoveryCodes, "user_id")).toBe(true);
    });
  });

  describe("§d2-enroll-shape — hai câu DELETE reset của enroll()", () => {
    /**
     * Harness RIÊNG. `makeSvc` truyền `{} as never` cho secrets/totp/tokens nên `enroll` nổ ngay ở
     * `this.totp.generateSecret()`. Ba mock dưới đây là TOÀN BỘ bề mặt ngoài-DB mà `enroll` chạm.
     *
     * ⚠️ `makeTx` dispatch CHỈ theo BẢNG (bẫy đã ăn một lần ở `#483` §5.2): câu `select userTotp`
     * kiểm `existing` phải trả `[]` để đi vào nhánh enroll-mới. `makeTx.rowsFor` trả `[]` cho mọi
     * bảng ngoài `users`/`userRoles` ⇒ đúng như cần, nhưng ĐỪNG đổi mặc định đó mà không đọc lại đây.
     */
    function makeEnrollSvc(tx: unknown) {
      const dbsvc = {
        withTenant: vi.fn(async (_cid: string, fn: (t: unknown) => Promise<unknown>) => fn(tx)),
      };
      // Kiểu tham số TƯỜNG MINH: `vi.fn(async () => undefined)` cho `mock.calls` kiểu `[]` ⇒
      // `.calls.at(-1)?.[1]` không biên dịch được. Ca dưới đây PHẢI đọc được đối số thứ hai.
      const audit = { record: vi.fn(async (..._args: unknown[]) => undefined) };
      const svc = new TwoFactorService(
        dbsvc as never,
        { encryptSecret: vi.fn(async () => ({})) } as never, // secrets
        { generateSecret: () => "SECRET", keyUri: () => "otpauth://x" } as never, // totp
        { hashToken: (c: string) => `h:${c}` } as never, // tokens
        audit as never,
        makeRateLimiterMock() as never,
        {} as never, // replayGuard
        { record: vi.fn(async () => undefined) } as never,
      );
      return { svc, audit };
    }

    it("DELETE user_totp mang CẢ company_id LẪN user_id", async () => {
      const { tx, captures } = makeTx({ userDeletedAt: null });
      const { svc } = makeEnrollSvc(tx);
      await svc.enroll(USER_ID, COMPANY_ID, {});
      expect(whereHasColumn(captures.totpDeleteWhere, userTotp, "company_id")).toBe(true);
      expect(whereHasColumn(captures.totpDeleteWhere, userTotp, "user_id")).toBe(true);
    });

    it("DELETE user_recovery_codes mang CẢ company_id LẪN user_id", async () => {
      const { tx, captures } = makeTx({ userDeletedAt: null });
      const { svc } = makeEnrollSvc(tx);
      await svc.enroll(USER_ID, COMPANY_ID, {});
      expect(whereHasColumn(captures.recoveryDeleteWhere, userRecoveryCodes, "company_id")).toBe(
        true,
      );
      expect(whereHasColumn(captures.recoveryDeleteWhere, userRecoveryCodes, "user_id")).toBe(true);
    });

    /**
     * Đối chứng ÂM cho chính harness trên: nếu `enroll` KHÔNG chặn user xoá mềm thì hai ca ở trên
     * vẫn xanh (chúng chỉ đo hình dạng WHERE của nhánh THÀNH CÔNG). Ca này ghim rằng nhánh chặn tồn
     * tại ở tầng unit, và rằng nó chặn TRƯỚC mọi lệnh ghi.
     */
    it("user xoá mềm ⇒ 401 và KHÔNG câu DELETE nào chạy", async () => {
      const { tx, calls } = makeTx({ userDeletedAt: new Date() });
      const { svc, audit } = makeEnrollSvc(tx);
      await expect(svc.enroll(USER_ID, COMPANY_ID, {})).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(calls.totpDeletes).toBe(0);
      expect(calls.recoveryDeletes).toBe(0);
      expect(audit.record.mock.calls.at(-1)?.[1]).toMatchObject({
        action: "auth.2fa_enroll_denied",
        after: { reason: "user_deleted" },
      });
    });
  });
});

// ── S18-AUTH-RESTORE2FA-1 (A2) — NEO DƯƠNG cho cờ per-user ─────────────────────────────────────
//
// ⚠️ VÌ SAO PHẢI CÓ. `vitest.config.ts` ép `TWO_FACTOR_ENFORCEMENT_ENABLED: "false"` cho TOÀN SUITE
// ⇒ nhánh `roleRequired` của `TwoFactorEnforcementGuard` KHÔNG BAO GIỜ chạy trong int-spec. Nếu A2
// chỉ có ca deny thì cả vế "ép enroll lại" là xanh-RỖNG
// (`deny-cases-vacuous-without-allow-case`). Ca dưới đây đo vế DƯƠNG ở tầng service, nơi env không
// can thiệp.
describe("TwoFactorService — §a2-pos-flag: cờ per-user do restore set ⇒ requiresTwoFactorTx = true", () => {
  it("users.require_two_factor=true (role KHÔNG cờ) ⇒ true — đây là thứ làm disable() 409 sau restore", async () => {
    const { tx } = makeTx({ userRequireTwoFactor: true, hasEnforcedRole: false });
    const { svc } = makeSvc(tx);
    expect(await svc.requiresTwoFactorTx(tx as never, USER_ID)).toBe(true);
  });
});

// ── S18-AUTH-RESTORE2FA-1 (D2 MỞ RỘNG — sau FULL gate, phát hiện MEDIUM-1) ─────────────────────
//
// `security-reviewer` đo đúng: D2 siết BỐN câu DELETE nhưng để lại HAI câu UPDATE chỉ dựa RLS — và
// một trong hai chính là câu ghi BẬT 2FA (`confirmEnable`). Mục tiêu tự khai của D2 là "hết hai
// giọng trong cùng một file", nên bỏ sót đúng câu quan trọng nhất thì mục tiêu đó chưa đạt.
//
// ⚠️ VÌ SAO LẠI ASSERT CÚ PHÁP (giống `§d2-*-shape`): `uniqueIndex("user_totp_user_uq").on(t.userId)`
// là UNIQUE TOÀN BẢNG ⇒ ca hành vi "UPDATE của A không đụng hàng của B" KHÔNG THỂ ĐỎ. Vế duy nhất
// đo được là hình dạng WHERE.
describe("TwoFactorService — D2 mở rộng: UPDATE user_totp / user_recovery_codes có company_id", () => {
  /**
   * Harness thứ BA trong file. KHÔNG mở rộng `makeTx` vì (a) nó không capture `update`, và (b) nó là
   * mock dùng chung của ~20 ca khác — thêm nhánh `update` + một hàng `user_totp` mặc định vào đó là
   * đổi tiền đề của những ca không liên quan (`same-builder-twice-makes-unit-spec-vacuous`).
   *
   * HAI hình dạng UPDATE khác nhau, phải giữ đúng: `userTotp` await THẲNG `.where()`, còn
   * `userRecoveryCodes` đi tiếp `.returning()`.
   */
  function makeUpdateTx(opts: { totpEnabled?: boolean } = {}) {
    const captures: { totpUpdateWhere?: unknown; recoveryUpdateWhere?: unknown } = {};
    const totpRow = {
      userId: USER_ID,
      enabledAt: opts.totpEnabled ? new Date() : null,
      secretCiphertext: "c",
      encryptedDek: "d",
      dekKeyVersion: 1,
      kmsKeyId: "k",
      ivNonce: "i",
      authTag: "a",
      encAlgo: "aes-256-gcm",
    };
    const tx = {
      select: (_cols?: unknown) => ({
        from: (table: unknown) => {
          const rowsFor = () => {
            if (table === users) return [{ deletedAt: null, requireTwoFactor: false }];
            if (table === userTotp) return [totpRow];
            return [];
          };
          const limitChain = { limit: () => Promise.resolve(rowsFor()) };
          const whereChain = { where: () => limitChain };
          return { ...whereChain, innerJoin: () => whereChain };
        },
      }),
      update: (table: unknown) => ({
        set: (_vals: unknown) => ({
          where: (cond?: unknown) => {
            if (table === userTotp) {
              captures.totpUpdateWhere = cond;
              return Promise.resolve(undefined);
            }
            captures.recoveryUpdateWhere = cond;
            return { returning: () => Promise.resolve([{ id: "r1" }]) };
          },
        }),
      }),
    };
    return { tx, captures };
  }

  function makeUpdateSvc(tx: unknown, opts: { totpVerifies: boolean }) {
    const dbsvc = {
      withTenant: vi.fn(async (_cid: string, fn: (t: unknown) => Promise<unknown>) => fn(tx)),
    };
    return new TwoFactorService(
      dbsvc as never,
      { decryptSecret: vi.fn(async () => "SECRET") } as never, // secrets
      { verify: () => opts.totpVerifies, currentStep: () => 1 } as never, // totp
      { hashToken: (c: string) => `h:${c}` } as never, // tokens
      { record: vi.fn(async () => undefined) } as never, // audit
      makeRateLimiterMock() as never,
      { claim: vi.fn(async () => true) } as never, // replayGuard
      { record: vi.fn(async () => undefined) } as never, // securityEvents
    );
  }

  it("§d2-enable-shape: UPDATE user_totp SET enabled_at mang CẢ company_id LẪN user_id", async () => {
    const { tx, captures } = makeUpdateTx();
    const svc = makeUpdateSvc(tx, { totpVerifies: true });
    await svc.confirmEnable(USER_ID, COMPANY_ID, "123456", {});
    expect(whereHasColumn(captures.totpUpdateWhere, userTotp, "company_id")).toBe(true);
    expect(whereHasColumn(captures.totpUpdateWhere, userTotp, "user_id")).toBe(true);
  });

  it("§d2-recovery-shape: UPDATE user_recovery_codes SET used_at mang CẢ company_id LẪN user_id", async () => {
    // `totpVerifies:false` ⇒ rơi xuống nhánh recovery-code; `totpEnabled:true` ⇒ qua chốt
    // `row.enabledAt == null` ở đầu `verifyChallenge` (thiếu nó thì hàm trả false SỚM và ca này
    // xanh-RỖNG vì câu UPDATE chưa từng chạy).
    const { tx, captures } = makeUpdateTx({ totpEnabled: true });
    const svc = makeUpdateSvc(tx, { totpVerifies: false });
    await expect(svc.verifyChallenge(USER_ID, COMPANY_ID, "recovery-code")).resolves.toBe(true);
    expect(whereHasColumn(captures.recoveryUpdateWhere, userRecoveryCodes, "company_id")).toBe(
      true,
    );
    expect(whereHasColumn(captures.recoveryUpdateWhere, userRecoveryCodes, "user_id")).toBe(true);
  });
});

// ── S18-AUTH-RESTORE2FA-1 (A2) — MẮT XÍCH UỶ QUYỀN (LOW của FULL gate) ─────────────────────────
//
// `§a2-pos-flag` chứng minh `requiresTwoFactorTx` tôn trọng cờ per-user; ca guard chứng minh 403 khi
// `requiresTwoFactor` trả true. Nhưng MẮT XÍCH nối hai đầu — `requiresTwoFactor` uỷ quyền xuống
// `requiresTwoFactorTx` trong `withTenant` — trước đây KHÔNG có ca nào. Cả lập luận "ở PROD A2 ép
// enroll thật" của plan §2 treo vào đúng một dòng không ai đo.
describe("TwoFactorService — §a2-pos-delegate: requiresTwoFactor uỷ quyền xuống requiresTwoFactorTx", () => {
  it("cờ per-user=true ⇒ requiresTwoFactor (đường controller) cũng true, và đi qua withTenant", async () => {
    const { tx } = makeTx({ userRequireTwoFactor: true, hasEnforcedRole: false });
    const { svc, dbsvc } = makeSvc(tx);
    expect(await svc.requiresTwoFactor(USER_ID, COMPANY_ID)).toBe(true);
    expect(dbsvc.withTenant).toHaveBeenCalledWith(COMPANY_ID, expect.any(Function));
  });
});

// ── S18-AUTH-490DEBT-1 (D4 — nợ §8.8 của #490) ─────────────────────────────────────────────────
describe("TwoFactorService.recordReauthFailure — nuốt lỗi NHƯNG mang ngữ cảnh truy vết", () => {
  /**
   * Tx tối thiểu để `confirmEnable` đi tới nhánh `bad_code`: hàng `users` CÒN SỐNG (qua được vế
   * `deleted_at` của D1 ở #490) + hàng `user_totp` đã enroll, rồi `totp.verify` trả false.
   */
  function makeBadCodeTx() {
    return {
      select: () => ({
        from: (table: unknown) => ({
          where: () => ({
            limit: () => {
              if (table === users) return Promise.resolve([{ deletedAt: null, email: "u@a.test" }]);
              if (table === userTotp)
                return Promise.resolve([{ enabledAt: null, secretCiphertext: "c" }]);
              return Promise.resolve([]);
            },
          }),
        }),
      }),
      update: () => ({ set: () => ({ where: () => Promise.resolve(undefined) }) }),
      insert: () => ({ values: () => Promise.resolve(undefined) }),
      delete: () => ({ where: () => Promise.resolve(undefined) }),
    };
  }

  function makeSvcWithFailingWriter(tx: unknown) {
    const dbsvc = {
      withTenant: vi.fn(async (_cid: string, fn: (t: unknown) => Promise<unknown>) => fn(tx)),
    };
    const securityEvents = {
      record: vi.fn(async () => {
        throw new Error("ghi timeline hỏng");
      }),
    };
    const svc = new TwoFactorService(
      dbsvc as never,
      { decryptSecret: vi.fn(async () => "PLAIN-SECRET-NOT-LOGGED") } as never,
      { verify: vi.fn(() => false), currentStep: vi.fn(() => 1) } as never,
      { hashToken: vi.fn(() => "h") } as never,
      { record: vi.fn(async () => undefined) } as never,
      makeRateLimiterMock() as never,
      { claim: vi.fn(async () => true) } as never,
      securityEvents as never,
    );
    return { svc, securityEvents };
  }

  /**
   * (a) NEO CHỐNG-HỒI-QUY cho quyết định "nuốt là CỐ Ý". `SecurityEventWriter.record` ném ⇒ outcome
   * PHẢI vẫn là 401. Biến nhánh này thành 500 là biến mất-tầm-nhìn thành mất-đăng-nhập.
   * Đột biến: bỏ khối `try/catch` ⇒ ca này ĐỎ (nhận Error thường thay vì UnauthorizedException).
   */
  it("§reauth-log-ctx-2fa (a): writer timeline NÉM ⇒ vẫn 401, KHÔNG 500", async () => {
    const { svc } = makeSvcWithFailingWriter(makeBadCodeTx());
    const { result: err } = await withExpectedLoggerErrors(
      [{ label: "reauth", match: /recordReauthFailure thất bại/ }],
      () => svc.confirmEnable(USER_ID, COMPANY_ID, "123456", {}).catch((e: unknown) => e),
    );
    expect(err).toBeInstanceOf(UnauthorizedException);
  });

  /**
   * (b) VẾ MỚI: dòng log phải trả lời được "hàng CỦA AI đã mất". Trước WO này nó chỉ có `err.message`.
   * Đột biến: bỏ ba trường khỏi chuỗi log ⇒ ca này ĐỎ.
   *
   * ⚠️ Cấm `ip`/`userAgent` trong log (không nhân bản PII) và cấm khoá Valkey (họ `rl:` nhúng
   * email/slug) — assert âm ở dưới ghim điều đó.
   */
  it("§reauth-log-ctx-2fa (b): dòng log mang companyId + userId + context, KHÔNG mang PII", async () => {
    const { svc } = makeSvcWithFailingWriter(makeBadCodeTx());
    const { matched } = await withExpectedLoggerErrors(
      [{ label: "reauth", match: /recordReauthFailure thất bại/, min: 1, max: 1 }],
      () => svc.confirmEnable(USER_ID, COMPANY_ID, "123456", {}).catch(() => undefined),
    );
    const line = matched.get("reauth")?.[0]?.message ?? "";
    expect(line).toContain(`companyId=${COMPANY_ID}`);
    expect(line).toContain(`userId=${USER_ID}`);
    expect(line).toContain("context=2fa_enable");
    // Regex chứ KHÔNG string literal: `valkey-key-census.spec.ts` neo mọi literal MỞ ĐẦU bằng tiền
    // tố khoá và sẽ báo file này là "chỗ dựng khoá thứ hai" — đỏ oan cho một assert ÂM.
    expect(line, "log KHÔNG được mang khoá Valkey (họ rl: nhúng email/slug)").not.toMatch(/rl:/);
  });
});
