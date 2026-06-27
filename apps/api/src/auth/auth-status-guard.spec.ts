import { beforeEach, describe, expect, it, vi } from "vitest";
import { UnauthorizedException } from "@nestjs/common";

/**
 * AUTH-FIX-1 — guard status='suspended' (crown-jewel deny-path, RED viết TRƯỚC theo §5.5).
 *
 * HIỆN TRẠNG (bug): login/refresh/2FA chỉ lọc `deleted_at IS NULL` → user bị SUSPEND (deletedAt=null,
 * mật khẩu ĐÚNG) VẪN đăng nhập/refresh được. Guard mới = ALLOW-LIST `status==='active'` (fail-closed cho
 * mọi trạng thái tương lai vd 'locked'/'pending'), KHÔNG phải deny-list 'suspended'.
 *
 * BẤT BIẾN ép trong test:
 *   - 401 ĐỒNG NHẤT (UNIFORM_LOGIN_ERROR) y như bad-password/not-found → KHÔNG lộ trạng thái (anti
 *     status-probing). Message KHÔNG chứa 'suspend'/'khoá'.
 *   - suspended login → KHÔNG cấp token (insert refreshTokens KHÔNG gọi) + vẫn chạy password.hash
 *     (timing-equalize, không khác nhánh not-found).
 *   - suspended refresh → THU HỒI token (family) + KHÔNG xoay.
 *   - audit deny ('auth.login_blocked'/'auth.refresh_blocked', objectType 'auth', reason='suspended')
 *     TRONG cùng tx (append-only). reason CHỈ ở audit — KHÔNG vào HTTP body.
 *
 * Mock theo style withTenant + tx của admin-users.service.spec.ts (không cần Postgres).
 */

// db/index.ts gọi loadEnv() lúc module-load → mock để không crash; resolveCompanyId dùng db.execute nên
// mock luôn `db` ở đây. db.execute trả company 'active' để login() đi tới nhánh withTenant.
const { dbExecuteMock } = vi.hoisted(() => ({ dbExecuteMock: vi.fn() }));
vi.mock("../config/env.schema", () => ({ loadEnv: () => ({}) }));
vi.mock("../db/index", () => ({
  db: { execute: dbExecuteMock },
}));

import { AuthService } from "./auth.service";
import { refreshTokens, users } from "../db/schema";
import type { AuditEntry } from "../events/audit.service";

/** Tìm 1 audit entry theo action trong các lần gọi audit.record (calls = [tx, entry][]). */
function findAudit(calls: [unknown, AuditEntry][], action: string): AuditEntry | undefined {
  return calls.find((c) => c[1]?.action === action)?.[1];
}

const COMPANY_ID = "22222222-2222-2222-2222-222222222222";
const USER_ID = "33333333-3333-3333-3333-333333333333";
const COMPANY_SLUG = "acme";
const EMAIL = "u@acme.test";
// Fixture creds (KHÔNG phải secret production — placeholder 'changeme' tránh lẫn secret thật).
const CRED = "changeme-fixture";
const CRED_HASH = "$argon2id$changeme-NEVER-IN-DTO";

function makeUserRow(over: Record<string, unknown> = {}) {
  return {
    id: USER_ID,
    companyId: COMPANY_ID,
    email: EMAIL,
    passwordHash: CRED_HASH,
    fullName: "Nguoi Dung",
    status: "active",
    createdAt: new Date("2026-06-19T00:00:00.000Z"),
    updatedAt: new Date("2026-06-19T00:00:00.000Z"),
    deletedAt: null,
    lastLoginAt: null,
    ...over,
  };
}

function makeRefreshRow(over: Record<string, unknown> = {}) {
  return {
    id: "rrrrrrrr-rrrr-rrrr-rrrr-rrrrrrrrrrrr",
    userId: USER_ID,
    familyId: "ffffffff-ffff-ffff-ffff-ffffffffffff",
    tokenHash: "hash",
    expiresAt: new Date(Date.now() + 60_000),
    revokedAt: null,
    replacedBy: null,
    ...over,
  };
}

interface TxCalls {
  refreshInserts: number;
  refreshUpdates: number;
}

/**
 * tx giả: phục vụ chuỗi drizzle builder cho login (select users + insert/update refreshTokens) và
 * refresh (select refreshTokens .for('update') + select users + update/insert). Trả theo BẢNG.
 */
function makeTx(opts: {
  userRow?: Record<string, unknown> | null;
  refreshRow?: Record<string, unknown> | null;
}): { tx: unknown; calls: TxCalls } {
  const calls: TxCalls = { refreshInserts: 0, refreshUpdates: 0 };
  const tx = {
    select: (_cols?: unknown) => ({
      from: (table: unknown) => {
        const rowsFor = () => {
          if (table === users) return opts.userRow ? [opts.userRow] : [];
          if (table === refreshTokens) return opts.refreshRow ? [opts.refreshRow] : [];
          return []; // userRoles (isOperatorTx) → KHÔNG operator
        };
        const limitChain = {
          limit: () => ({
            // refresh() dùng .for('update') sau .limit(); login dùng await trực tiếp (thenable).
            for: () => Promise.resolve(rowsFor()),
            then: (resolve: (v: unknown) => unknown) => resolve(rowsFor()),
          }),
        };
        const whereChain = { where: () => limitChain };
        // isOperatorTx: select().from(userRoles).innerJoin(roles).where().limit()
        return { ...whereChain, innerJoin: () => whereChain };
      },
    }),
    insert: (table: unknown) => ({
      values: () => {
        if (table === refreshTokens) calls.refreshInserts += 1;
        return {
          returning: () => Promise.resolve([{ id: "new-token-id" }]),
        };
      },
    }),
    update: (table: unknown) => ({
      set: () => ({
        where: () => {
          if (table === refreshTokens) calls.refreshUpdates += 1;
          return Promise.resolve(undefined);
        },
      }),
    }),
  };
  return { tx, calls };
}

function makeDeps(tx: unknown) {
  const dbsvc = {
    withTenant: vi.fn(async (_cid: string, fn: (t: unknown) => Promise<unknown>) => fn(tx)),
  };
  const password = {
    hash: vi.fn(async () => CRED_HASH),
    verify: vi.fn(async () => true),
  };
  const tokens = {
    hashToken: vi.fn(() => "hash"),
    generateOpaqueToken: vi.fn(() => "opaque"),
    signAccessToken: vi.fn(() => "at"),
    signTwoFactorChallenge: vi.fn(() => "challenge"),
    verifyTwoFactorChallenge: vi.fn(() => ({ sub: USER_ID, companyId: COMPANY_ID, jti: "jti" })),
    accessTtlSec: 900,
    operatorAccessTtlSec: 300,
    refreshTtlSec: 1209600,
  };
  const rateLimiter = {
    isLocked: vi.fn(async () => false),
    recordFailure: vi.fn(async () => undefined),
    reset: vi.fn(async () => undefined),
    accountMaxAttempts: 20,
  };
  const audit = { record: vi.fn(async (_tx: unknown, _entry: AuditEntry) => undefined) };
  const outbox = { enqueue: vi.fn(async () => undefined) };
  const permissions = {};
  const secrets = {};
  const twoFactor = {
    isEnabledTx: vi.fn(async () => false),
    verifyChallenge: vi.fn(async () => true),
  };
  const replayGuard = { claim: vi.fn(async () => true) };
  const securityAlerts = { emit: vi.fn(async () => undefined) };
  const securityPolicy = {
    evaluateAccessTx: vi.fn(async () => ({ allowed: true })),
  };
  const service = new AuthService(
    dbsvc as never,
    password as never,
    tokens as never,
    rateLimiter as never,
    audit as never,
    outbox as never,
    permissions as never,
    secrets as never,
    twoFactor as never,
    replayGuard as never,
    securityAlerts as never,
    securityPolicy as never,
    { getMyApps: async () => [] } as never,
  );
  return { service, dbsvc, password, tokens, audit, twoFactor };
}

beforeEach(() => {
  vi.clearAllMocks();
  // resolveCompanyId → company 'active'
  dbExecuteMock.mockResolvedValue({ rows: [{ id: COMPANY_ID, status: "active" }] });
});

const META = { ip: "1.2.3.4", userAgent: "vitest" };
const LOGIN_REQ = { companySlug: COMPANY_SLUG, email: EMAIL, password: CRED };

// ── login() ──────────────────────────────────────────────────────────────────

describe("login() — guard status='suspended'", () => {
  it("suspended (mật khẩu ĐÚNG) → 401 UNIFORM, message KHÔNG lộ trạng thái", async () => {
    const { tx } = makeTx({ userRow: makeUserRow({ status: "suspended" }) });
    const { service } = makeDeps(tx);
    await expect(service.login(LOGIN_REQ, META)).rejects.toBeInstanceOf(UnauthorizedException);
    try {
      await service.login(LOGIN_REQ, META);
    } catch (e) {
      const msg = (e as Error).message.toLowerCase();
      expect(msg).not.toContain("suspend");
      expect(msg).not.toContain("khoá");
      expect(msg).not.toContain("khoa");
    }
  });

  it("suspended → KHÔNG cấp token (KHÔNG insert refreshTokens)", async () => {
    const { tx, calls } = makeTx({ userRow: makeUserRow({ status: "suspended" }) });
    const { service } = makeDeps(tx);
    await expect(service.login(LOGIN_REQ, META)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(calls.refreshInserts).toBe(0);
  });

  it("suspended → guard ĐẶT SAU password.verify (timing đều với happy path, không là oracle)", async () => {
    // Đặt guard SAU verify ⇒ suspended đi đúng đường verify như login active thành công / bad-password trên
    // user active ⇒ KHÔNG phân biệt được qua timing (anti timing side-channel). Nếu guard đặt TRƯỚC verify,
    // suspended sẽ KHÔNG gọi verify (return sớm) → test này đỏ, lộ oracle.
    const { tx } = makeTx({ userRow: makeUserRow({ status: "suspended" }) });
    const { service, password } = makeDeps(tx);
    await expect(service.login(LOGIN_REQ, META)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(password.verify).toHaveBeenCalledWith(CRED_HASH, CRED);
  });

  it("suspended → audit deny 'auth.login_blocked' reason='suspended' trong cùng tx", async () => {
    const { tx } = makeTx({ userRow: makeUserRow({ status: "suspended" }) });
    const { service, audit } = makeDeps(tx);
    await expect(service.login(LOGIN_REQ, META)).rejects.toBeInstanceOf(UnauthorizedException);
    const entry = findAudit(audit.record.mock.calls, "auth.login_blocked");
    expect(entry).toBeDefined();
    expect(entry?.objectType).toBe("auth");
    expect((entry?.after as { reason: string }).reason).toBe("suspended");
  });

  it("active (happy path) → KHÔNG ném, trả tokens", async () => {
    const { tx } = makeTx({ userRow: makeUserRow({ status: "active" }) });
    const { service } = makeDeps(tx);
    const res = await service.login(LOGIN_REQ, META);
    expect(res).toHaveProperty("accessToken");
  });
});

// ── refresh() ──────────────────────────────────────────────────────────────────

describe("refresh() — guard status='suspended'", () => {
  const REFRESH_TOKEN = `${COMPANY_ID}.opaque`;

  it("token còn sống nhưng owner suspended → 401 UNIFORM, KHÔNG xoay (KHÔNG insert)", async () => {
    const { tx, calls } = makeTx({
      userRow: makeUserRow({ status: "suspended" }),
      refreshRow: makeRefreshRow(),
    });
    const { service } = makeDeps(tx);
    await expect(service.refresh(REFRESH_TOKEN, META)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(calls.refreshInserts).toBe(0);
  });

  it("owner suspended → THU HỒI token (family) + audit 'auth.refresh_blocked' reason='suspended'", async () => {
    const { tx, calls } = makeTx({
      userRow: makeUserRow({ status: "suspended" }),
      refreshRow: makeRefreshRow(),
    });
    const { service, audit } = makeDeps(tx);
    await expect(service.refresh(REFRESH_TOKEN, META)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    // revoke: ít nhất 1 update refreshTokens (family)
    expect(calls.refreshUpdates).toBeGreaterThanOrEqual(1);
    const entry = findAudit(audit.record.mock.calls, "auth.refresh_blocked");
    expect(entry).toBeDefined();
    expect(entry?.objectType).toBe("auth");
    expect((entry?.after as { reason: string }).reason).toBe("suspended");
  });

  it("owner active (happy path) → xoay token bình thường (regression)", async () => {
    const { tx, calls } = makeTx({
      userRow: makeUserRow({ status: "active" }),
      refreshRow: makeRefreshRow(),
    });
    const { service } = makeDeps(tx);
    const res = await service.refresh(REFRESH_TOKEN, META);
    expect(res).toHaveProperty("accessToken");
    expect(calls.refreshInserts).toBe(1);
  });
});

// ── completeTwoFactorLogin() — path login thứ 3 ────────────────────────────────

describe("completeTwoFactorLogin() — guard status='suspended'", () => {
  it("step-2 user suspended → 401 UNIFORM, KHÔNG cấp token", async () => {
    const { tx, calls } = makeTx({ userRow: makeUserRow({ status: "suspended" }) });
    const { service } = makeDeps(tx);
    await expect(
      service.completeTwoFactorLogin("challenge", "123456", META),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(calls.refreshInserts).toBe(0);
  });

  it("step-2 user active → cấp token (regression)", async () => {
    const { tx, calls } = makeTx({ userRow: makeUserRow({ status: "active" }) });
    const { service } = makeDeps(tx);
    const res = await service.completeTwoFactorLogin("challenge", "123456", META);
    expect(res).toHaveProperty("accessToken");
    expect(calls.refreshInserts).toBe(1);
  });
});
