/**
 * CS-10 (🔴 CROWN-JEWEL) — Mời / Duyệt / Kích hoạt user qua UserInvitesService + Repository THẬT
 * (Postgres, withTenant + RLS). DB cô lập (LANE_DB=mediaos_cs10).
 *
 * Phủ end-to-end: invite → accept (token, sessionless, đặt mật khẩu) → approve (tạo users ACTIVE).
 * BẤT BIẾN soi: token chỉ qua "email" (mock) → lưu hash; single-use (accept lần 2 fail); email-domain (CS-9)
 * chặn tại accept; cổng-duyệt THẬT (users row CHỈ sinh ở approve); 2-tenant isolation (token A ko dùng ở B).
 */
import "reflect-metadata";

import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PasswordService } from "../../src/auth/password.service";
import { DatabaseService } from "../../src/db/db.service";
import { AuditService } from "../../src/events/audit.service";
import { SecurityPolicyRepository } from "../../src/security-policy/security-policy.repository";
import { SecurityPolicyService } from "../../src/security-policy/security-policy.service";
import { SecurityPolicyEvaluator } from "../../src/security-policy/security-policy-evaluator";
import { UserInvitesRepository } from "../../src/user-invites/user-invites.repository";
import { UserInvitesService } from "../../src/user-invites/user-invites.service";
import { hashInviteToken } from "../../src/user-invites/user-invite-token.util";
import { directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";

describe.skipIf(!hasDb)("CS-10 UserInvitesService flow (withTenant + RLS THẬT)", () => {
  let direct: Pool;
  let dbsvc: DatabaseService;
  let service: UserInvitesService;
  let policy: SecurityPolicyService;
  // Mock mail: bắt token THẬT (chỉ đi qua email) để test accept; mặc định sent:false (không SMTP).
  const sentTokens: string[] = [];
  const mailMock = {
    sendActivationEmail: vi.fn(async (p: { token: string }) => {
      sentTokens.push(p.token);
      return { sent: false as const, reason: "no_mail_config" as const };
    }),
  };
  let A: SeededTenant;
  let B: SeededTenant;
  let adminA: string;
  const companyIds: string[] = [];

  beforeAll(async () => {
    direct = directPool();
    dbsvc = new DatabaseService();
    const repo = new UserInvitesRepository(dbsvc);
    const policyRepo = new SecurityPolicyRepository(dbsvc);
    policy = new SecurityPolicyService(
      dbsvc,
      policyRepo,
      new SecurityPolicyEvaluator(),
      new AuditService(),
    );
    service = new UserInvitesService(
      dbsvc,
      repo,
      new PasswordService(),
      new AuditService(),
      policy,
      mailMock as never,
    );

    A = await seedCompany(direct, "cs10a");
    B = await seedCompany(direct, "cs10b");
    companyIds.push(A.companyId, B.companyId);
    adminA = await seedUser(direct, A.companyId, `admin-${randomUUID().slice(0, 8)}@cs10a.local`);
  });

  afterAll(async () => {
    await cleanupTenants(direct, companyIds);
    await direct.end();
  });

  beforeEach(() => {
    sentTokens.length = 0;
    mailMock.sendActivationEmail.mockClear();
  });

  it("invite → token băm lưu DB (KHÔNG token thật), token thật đi qua mail; users chưa tạo", async () => {
    const email = `newbie-${randomUUID().slice(0, 8)}@cs10a.local`;
    const res = await service.invite(
      { id: adminA, companyId: A.companyId },
      { email, fullName: "Người Mới" },
    );

    expect(res.invite.status).toBe("pending");
    expect(res.invite).not.toHaveProperty("tokenHash");
    expect(res.emailSent).toBe(false); // mock no-config
    expect(sentTokens).toHaveLength(1);
    expect(sentTokens[0]).not.toMatch(/^[0-9a-f]{64}$/); // token thật, KHÔNG phải hash

    // DB lưu hash, KHÔNG token thật; chưa có users.
    const stored = await dbsvc.withTenant(A.companyId, async (tx) => {
      const r = await tx.execute(
        sql`SELECT token_hash, status, password_hash FROM user_invites WHERE id = ${res.invite.id}`,
      );
      return r.rows[0] as { token_hash: string; status: string; password_hash: string | null };
    });
    expect(stored.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.token_hash).not.toBe(sentTokens[0]);
    expect(stored.password_hash).toBeNull();

    const userCount = await dbsvc.withTenant(A.companyId, async (tx) => {
      const r = await tx.execute(
        sql`SELECT count(*)::int AS n FROM users WHERE lower(email) = ${email.toLowerCase()}`,
      );
      return (r.rows[0] as { n: number }).n;
    });
    expect(userCount).toBe(0);
  });

  it("accept đặt mật khẩu → status accepted + password_hash set; single-use (lần 2 fail); users vẫn chưa tạo", async () => {
    const email = `act-${randomUUID().slice(0, 8)}@cs10a.local`;
    const { invite } = await service.invite(
      { id: adminA, companyId: A.companyId },
      { email, fullName: "Kích Hoạt" },
    );
    const token = sentTokens[0];

    const accepted = await service.accept({ companySlug: A.slug, token, password: "Sup3rSecret!" });
    expect(accepted.status).toBe("accepted");

    const row = await dbsvc.withTenant(A.companyId, async (tx) => {
      const r = await tx.execute(
        sql`SELECT status, password_hash, accepted_at FROM user_invites WHERE id = ${invite.id}`,
      );
      return r.rows[0] as {
        status: string;
        password_hash: string | null;
        accepted_at: Date | null;
      };
    });
    expect(row.status).toBe("accepted");
    expect(row.password_hash).toMatch(/^\$argon2/); // argon2 hash, KHÔNG plaintext
    expect(row.accepted_at).not.toBeNull();

    // single-use: dùng lại token → fail (đã accepted).
    await expect(
      service.accept({ companySlug: A.slug, token, password: "Other!1234" }),
    ).rejects.toThrow();

    // Cổng-duyệt: users CHƯA tạo (chỉ ở approve).
    const userCount = await dbsvc.withTenant(A.companyId, async (tx) => {
      const r = await tx.execute(
        sql`SELECT count(*)::int AS n FROM users WHERE lower(email) = ${email.toLowerCase()}`,
      );
      return (r.rows[0] as { n: number }).n;
    });
    expect(userCount).toBe(0);
  });

  it("approve → tạo users ACTIVE từ invite; invite status approved + created_user_id", async () => {
    const email = `appr-${randomUUID().slice(0, 8)}@cs10a.local`;
    const { invite } = await service.invite(
      { id: adminA, companyId: A.companyId },
      { email, fullName: "Được Duyệt" },
    );
    await service.accept({ companySlug: A.slug, token: sentTokens[0], password: "Sup3rSecret!" });

    const approved = await service.approve({ id: adminA, companyId: A.companyId }, invite.id);
    expect(approved.status).toBe("approved");
    expect(approved.createdUserId).not.toBeNull();

    // users row ACTIVE tồn tại với email + password_hash từ invite.
    const user = await dbsvc.withTenant(A.companyId, async (tx) => {
      const r = await tx.execute(
        sql`SELECT id, status, password_hash FROM users WHERE id = ${approved.createdUserId}`,
      );
      return r.rows[0] as { id: string; status: string; password_hash: string };
    });
    expect(user.status).toBe("active");
    expect(user.password_hash).toMatch(/^\$argon2/);
  });

  it("email-domain (CS-9) chặn tại ACCEPT: invite email ngoài allowlist → accept fail, users không tạo", async () => {
    // Policy A: chỉ cho domain 'allowed.example'.
    await policy.updatePolicy(
      A.companyId,
      { emailDomainRestrictionEnabled: true, allowedEmailDomains: ["allowed.example"] },
      adminA,
    );
    const email = `outsider-${randomUUID().slice(0, 8)}@evil.example`;
    await service.invite({ id: adminA, companyId: A.companyId }, { email, fullName: "Ngoài Miền" });

    await expect(
      service.accept({ companySlug: A.slug, token: sentTokens[0], password: "Sup3rSecret!" }),
    ).rejects.toThrow();

    // Dọn policy để không ảnh hưởng test khác (tắt restriction).
    await policy.updatePolicy(A.companyId, { emailDomainRestrictionEnabled: false }, adminA);
  });

  it("2-tenant ISOLATION: token của A KHÔNG dùng được khi resolve sang công ty B", async () => {
    const email = `iso-${randomUUID().slice(0, 8)}@cs10a.local`;
    await service.invite({ id: adminA, companyId: A.companyId }, { email, fullName: "Cô Lập" });
    const tokenA = sentTokens[0];

    // Dùng slug của B + token của A → withTenant(B) không thấy invite (RLS lọc company_id) → fail.
    await expect(
      service.accept({ companySlug: B.slug, token: tokenA, password: "Sup3rSecret!" }),
    ).rejects.toThrow();
  });

  it("double-approve TUẦN TỰ: tạo ĐÚNG 1 tài khoản; approve lần 2 ném, KHÔNG tạo user thừa (no orphan)", async () => {
    const email = `dbl-${randomUUID().slice(0, 8)}@cs10a.local`;
    const { invite } = await service.invite(
      { id: adminA, companyId: A.companyId },
      { email, fullName: "Hai Lần" },
    );
    await service.accept({ companySlug: A.slug, token: sentTokens[0], password: "Sup3rSecret!" });

    await service.approve({ id: adminA, companyId: A.companyId }, invite.id);
    // Lần 2: invite đã 'approved' → guard ném (KHÔNG chạy createUser).
    await expect(
      service.approve({ id: adminA, companyId: A.companyId }, invite.id),
    ).rejects.toThrow();

    const count = await dbsvc.withTenant(A.companyId, async (tx) => {
      const r = await tx.execute(
        sql`SELECT count(*)::int AS n FROM users WHERE lower(email) = ${email.toLowerCase()} AND deleted_at IS NULL`,
      );
      return (r.rows[0] as { n: number }).n;
    });
    expect(count).toBe(1);
  });

  it("reject: lời mời → rejected; accept SAU reject thất bại (status không pending)", async () => {
    const email = `rej-${randomUUID().slice(0, 8)}@cs10a.local`;
    const { invite } = await service.invite(
      { id: adminA, companyId: A.companyId },
      { email, fullName: "Bị Từ Chối" },
    );
    const token = sentTokens[0];

    const rejected = await service.reject({ id: adminA, companyId: A.companyId }, invite.id);
    expect(rejected.status).toBe("rejected");

    await expect(
      service.accept({ companySlug: A.slug, token, password: "Sup3rSecret!" }),
    ).rejects.toThrow();
  });

  it("re-invite SAU reject: partial-unique CHỈ chặn 'pending' → mời lại cùng email được phép", async () => {
    const email = `reinv-${randomUUID().slice(0, 8)}@cs10a.local`;
    const first = await service.invite(
      { id: adminA, companyId: A.companyId },
      { email, fullName: "Mời Lại" },
    );
    await service.reject({ id: adminA, companyId: A.companyId }, first.invite.id);

    // Mời lại cùng email → KHÔNG bị chặn (lời mời cũ đã 'rejected', không còn 'pending').
    const second = await service.invite(
      { id: adminA, companyId: A.companyId },
      { email, fullName: "Mời Lại 2" },
    );
    expect(second.invite.status).toBe("pending");
    expect(second.invite.id).not.toBe(first.invite.id);
  });

  it("expired: lời mời pending HẾT HẠN (seed expires_at quá khứ) → accept thất bại", async () => {
    const email = `exp-${randomUUID().slice(0, 8)}@cs10a.local`;
    const token = "EXPIRED-TOKEN-VALUE";
    // Seed trực tiếp (direct pool, bypass RLS) một lời mời pending ĐÃ hết hạn với token_hash đã biết.
    await direct.query(
      `INSERT INTO user_invites (company_id, email, full_name, token_hash, status, expires_at, invited_by)
       VALUES ($1, $2, 'Hết Hạn', $3, 'pending', now() - interval '1 hour', $4)`,
      [A.companyId, email, hashInviteToken(token), adminA],
    );
    await expect(
      service.accept({ companySlug: A.slug, token, password: "Sup3rSecret!" }),
    ).rejects.toThrow();
  });
});
