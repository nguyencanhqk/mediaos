/**
 * CS-10 UserInvitesService — unit specs (no DB; repo/password/audit/securityPolicy/mail/db mocked).
 *
 * 🔴 BẤT BIẾN soi: DTO KHÔNG token_hash/password_hash; accept uniform-error + single-use + expiry +
 * email-domain (CS-9); cổng-duyệt tạo users CHỈ ở approve; email best-effort không nuốt (emailSent flag).
 */
import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UserInvitesService } from "./user-invites.service";

const COMPANY = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const ACTOR = { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", companyId: COMPANY };
const INVITE_ID = "11111111-1111-1111-1111-111111111111";

function inviteRow(over: Record<string, unknown> = {}) {
  return {
    id: INVITE_ID,
    companyId: COMPANY,
    email: "newbie@company.com",
    fullName: "Người Mới",
    tokenHash: "x".repeat(64),
    status: "pending",
    passwordHash: null,
    expiresAt: new Date(Date.now() + 72 * 3600 * 1000),
    acceptedAt: null,
    createdUserId: null,
    invitedBy: ACTOR.id,
    createdAt: new Date("2026-06-18T00:00:00.000Z"),
    updatedAt: new Date("2026-06-18T00:00:00.000Z"),
    ...over,
  };
}

function makeService(
  over: {
    repo?: Record<string, unknown>;
    password?: Record<string, unknown>;
    securityPolicy?: Record<string, unknown>;
    mail?: Record<string, unknown>;
    runRaw?: unknown;
  } = {},
) {
  const tx = { __tx: true };
  const db = {
    withTenant: vi.fn((_cid: string, fn: (t: unknown) => unknown) => fn(tx)),
    runRaw:
      (over.runRaw as ReturnType<typeof vi.fn>) ??
      vi.fn().mockResolvedValue([{ id: COMPANY, status: "active" }]),
  };
  const repo = {
    findActiveByEmailTx: vi.fn().mockResolvedValue(undefined),
    findLiveUserByEmailTx: vi.fn().mockResolvedValue(undefined),
    findCompanyTx: vi.fn().mockResolvedValue({ slug: "demo", name: "Demo Co" }),
    insertTx: vi.fn().mockResolvedValue(inviteRow()),
    findByTokenHashTx: vi.fn(),
    findByIdTx: vi.fn(),
    listQueue: vi.fn().mockResolvedValue([inviteRow()]),
    markAcceptedTx: vi.fn(),
    markApprovedTx: vi.fn(),
    markRejectedTx: vi.fn(),
    createUserTx: vi.fn().mockResolvedValue({ id: "uuuuuuuu-uuuu-uuuu-uuuu-uuuuuuuuuuuu" }),
    ...over.repo,
  };
  const password = { hash: vi.fn().mockResolvedValue("ARGON2HASH"), ...over.password };
  const audit = { record: vi.fn() };
  const securityPolicy = {
    assertEmailDomainAllowedTx: vi.fn().mockResolvedValue(true),
    ...over.securityPolicy,
  };
  const mail = {
    sendActivationEmail: vi.fn().mockResolvedValue({ sent: true }),
    ...over.mail,
  };
  const svc = new UserInvitesService(
    db as never,
    repo as never,
    password as never,
    audit as never,
    securityPolicy as never,
    mail as never,
  );
  return { svc, db, repo, password, audit, securityPolicy, mail };
}

// ── invite ────────────────────────────────────────────────────────────────

describe("invite", () => {
  it("tạo lời mời + audit + gửi email; DTO KHÔNG token_hash/password_hash", async () => {
    const { svc, repo, audit, mail } = makeService();
    const res = await svc.invite(ACTOR, { email: "newbie@company.com", fullName: "Người Mới" });

    expect(repo.insertTx).toHaveBeenCalledOnce();
    // token_hash truyền cho repo là 64-hex (đã băm) — KHÔNG token thật.
    expect(repo.insertTx.mock.calls[0][2].tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "invite.created",
        objectType: "user_invite",
      }),
    );
    // audit after-snapshot KHÔNG chứa token/password.
    const after = audit.record.mock.calls[0][1].after;
    expect(after).not.toHaveProperty("tokenHash");
    expect(after).not.toHaveProperty("passwordHash");
    expect(mail.sendActivationEmail).toHaveBeenCalledOnce();
    // mail nhận token THẬT (không phải hash).
    expect(mail.sendActivationEmail.mock.calls[0][0].token).not.toMatch(/^[0-9a-f]{64}$/);
    expect(res.emailSent).toBe(true);
    expect(res.invite).not.toHaveProperty("tokenHash");
    expect(res.invite).not.toHaveProperty("passwordHash");
    expect(res.invite.status).toBe("pending");
  });

  it("email gửi thất bại → emailSent=false NHƯNG lời mời vẫn tạo (không nuốt)", async () => {
    const { svc, repo, mail } = makeService({
      mail: {
        sendActivationEmail: vi.fn().mockResolvedValue({ sent: false, reason: "no_mail_config" }),
      },
    });
    const res = await svc.invite(ACTOR, { email: "newbie@company.com", fullName: "Người Mới" });
    expect(repo.insertTx).toHaveBeenCalledOnce();
    expect(res.emailSent).toBe(false);
    expect(mail.sendActivationEmail).toHaveBeenCalledOnce();
  });

  it("đã có lời mời đang chờ → Conflict, KHÔNG insert", async () => {
    const { svc, repo } = makeService({
      repo: { findActiveByEmailTx: vi.fn().mockResolvedValue(inviteRow()) },
    });
    await expect(
      svc.invite(ACTOR, { email: "newbie@company.com", fullName: "X" }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repo.insertTx).not.toHaveBeenCalled();
  });

  it("email đã có tài khoản → Conflict, KHÔNG insert", async () => {
    const { svc, repo } = makeService({
      repo: { findLiveUserByEmailTx: vi.fn().mockResolvedValue({ id: "u" }) },
    });
    await expect(
      svc.invite(ACTOR, { email: "dup@company.com", fullName: "X" }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repo.insertTx).not.toHaveBeenCalled();
  });

  it("đua partial-unique (23505) khi insert → Conflict", async () => {
    const { svc } = makeService({
      repo: {
        insertTx: vi.fn().mockRejectedValue(Object.assign(new Error("dup"), { code: "23505" })),
      },
    });
    await expect(
      svc.invite(ACTOR, { email: "newbie@company.com", fullName: "X" }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

// ── accept ──────────────────────────────────────────────────────────────────

describe("accept", () => {
  const base = { companySlug: "demo", token: "PLAINTOKEN", password: "Sup3rSecret!" };

  it("slug không resolve → BadRequest uniform, KHÔNG mở tenant", async () => {
    const { svc, db } = makeService({ runRaw: vi.fn().mockResolvedValue([]) });
    await expect(svc.accept(base)).rejects.toBeInstanceOf(BadRequestException);
    expect(db.withTenant).not.toHaveBeenCalled();
  });

  it("công ty không active → BadRequest uniform", async () => {
    const { svc } = makeService({
      runRaw: vi.fn().mockResolvedValue([{ id: COMPANY, status: "suspended" }]),
    });
    await expect(svc.accept(base)).rejects.toBeInstanceOf(BadRequestException);
  });

  it("token không tồn tại → BadRequest, KHÔNG hash/markAccepted", async () => {
    const { svc, repo, password } = makeService({
      repo: { findByTokenHashTx: vi.fn().mockResolvedValue(undefined) },
    });
    await expect(svc.accept(base)).rejects.toBeInstanceOf(BadRequestException);
    expect(password.hash).not.toHaveBeenCalled();
    expect(repo.markAcceptedTx).not.toHaveBeenCalled();
  });

  it("token hết hạn → BadRequest", async () => {
    const expired = inviteRow({ expiresAt: new Date(Date.now() - 1000) });
    // tokenHash của row phải khớp hash của token trình bày → set theo util.
    const { hashInviteToken } = await import("./user-invite-token.util");
    expired.tokenHash = hashInviteToken(base.token);
    const { svc } = makeService({
      repo: { findByTokenHashTx: vi.fn().mockResolvedValue(expired) },
    });
    await expect(svc.accept(base)).rejects.toBeInstanceOf(BadRequestException);
  });

  it("đã accepted (acceptedAt set) → BadRequest", async () => {
    const { hashInviteToken } = await import("./user-invite-token.util");
    const used = inviteRow({
      status: "accepted",
      acceptedAt: new Date(),
      tokenHash: hashInviteToken(base.token),
    });
    const { svc } = makeService({ repo: { findByTokenHashTx: vi.fn().mockResolvedValue(used) } });
    await expect(svc.accept(base)).rejects.toBeInstanceOf(BadRequestException);
  });

  it("email-domain bị từ chối (CS-9) → BadRequest, KHÔNG markAccepted", async () => {
    const { hashInviteToken } = await import("./user-invite-token.util");
    const row = inviteRow({ tokenHash: hashInviteToken(base.token) });
    const { svc, repo } = makeService({
      repo: { findByTokenHashTx: vi.fn().mockResolvedValue(row) },
      securityPolicy: { assertEmailDomainAllowedTx: vi.fn().mockResolvedValue(false) },
    });
    await expect(svc.accept(base)).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.markAcceptedTx).not.toHaveBeenCalled();
  });

  it("hợp lệ → hash password + markAccepted + audit; trả status accepted", async () => {
    const { hashInviteToken } = await import("./user-invite-token.util");
    const row = inviteRow({ tokenHash: hashInviteToken(base.token) });
    const accepted = inviteRow({
      status: "accepted",
      acceptedAt: new Date(),
      tokenHash: row.tokenHash,
      passwordHash: "ARGON2HASH",
    });
    const { svc, repo, password, audit } = makeService({
      repo: {
        findByTokenHashTx: vi.fn().mockResolvedValue(row),
        markAcceptedTx: vi.fn().mockResolvedValue(accepted),
      },
    });
    const res = await svc.accept(base);
    expect(password.hash).toHaveBeenCalledWith(base.password);
    // markAccepted nhận passwordHash đã băm (không plaintext).
    expect(repo.markAcceptedTx.mock.calls[0][3]).toBe("ARGON2HASH");
    expect(audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "invite.accepted" }),
    );
    expect(res.status).toBe("accepted");
  });

  it("single-use đua (markAccepted trả undefined) → BadRequest", async () => {
    const { hashInviteToken } = await import("./user-invite-token.util");
    const row = inviteRow({ tokenHash: hashInviteToken(base.token) });
    const { svc } = makeService({
      repo: {
        findByTokenHashTx: vi.fn().mockResolvedValue(row),
        markAcceptedTx: vi.fn().mockResolvedValue(undefined),
      },
    });
    await expect(svc.accept(base)).rejects.toBeInstanceOf(BadRequestException);
  });
});

// ── approve ───────────────────────────────────────────────────────────────

describe("approve", () => {
  it("không tìm thấy → NotFound", async () => {
    const { svc } = makeService({ repo: { findByIdTx: vi.fn().mockResolvedValue(undefined) } });
    await expect(svc.approve(ACTOR, INVITE_ID)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("status != accepted → BadRequest, KHÔNG tạo user", async () => {
    const { svc, repo } = makeService({
      repo: { findByIdTx: vi.fn().mockResolvedValue(inviteRow({ status: "pending" })) },
    });
    await expect(svc.approve(ACTOR, INVITE_ID)).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.createUserTx).not.toHaveBeenCalled();
  });

  it("accepted nhưng thiếu password_hash → BadRequest (không tạo tài khoản không mật khẩu)", async () => {
    const { svc, repo } = makeService({
      repo: {
        findByIdTx: vi
          .fn()
          .mockResolvedValue(inviteRow({ status: "accepted", passwordHash: null })),
      },
    });
    await expect(svc.approve(ACTOR, INVITE_ID)).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.createUserTx).not.toHaveBeenCalled();
  });

  it("hợp lệ → tạo users ACTIVE + markApproved + audit; DTO status approved", async () => {
    const accepted = inviteRow({ status: "accepted", passwordHash: "ARGON2HASH" });
    const approved = inviteRow({
      status: "approved",
      passwordHash: "ARGON2HASH",
      createdUserId: "uuuuuuuu-uuuu-uuuu-uuuu-uuuuuuuuuuuu",
    });
    const { svc, repo, audit } = makeService({
      repo: {
        findByIdTx: vi.fn().mockResolvedValue(accepted),
        markApprovedTx: vi.fn().mockResolvedValue(approved),
      },
    });
    const res = await svc.approve(ACTOR, INVITE_ID);
    expect(repo.createUserTx).toHaveBeenCalledWith(expect.anything(), COMPANY, {
      email: accepted.email,
      fullName: accepted.fullName,
      passwordHash: "ARGON2HASH",
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "invite.approved" }),
    );
    expect(res.status).toBe("approved");
    expect(res.createdUserId).toBe("uuuuuuuu-uuuu-uuuu-uuuu-uuuuuuuuuuuu");
    expect(res).not.toHaveProperty("passwordHash");
  });

  it("email tài khoản trùng (23505 khi createUser) → Conflict", async () => {
    const accepted = inviteRow({ status: "accepted", passwordHash: "ARGON2HASH" });
    const { svc } = makeService({
      repo: {
        findByIdTx: vi.fn().mockResolvedValue(accepted),
        createUserTx: vi.fn().mockRejectedValue(Object.assign(new Error("dup"), { code: "23505" })),
      },
    });
    await expect(svc.approve(ACTOR, INVITE_ID)).rejects.toBeInstanceOf(ConflictException);
  });

  it("đua double-approve (markApproved trả undefined) → Conflict", async () => {
    const accepted = inviteRow({ status: "accepted", passwordHash: "ARGON2HASH" });
    const { svc } = makeService({
      repo: {
        findByIdTx: vi.fn().mockResolvedValue(accepted),
        markApprovedTx: vi.fn().mockResolvedValue(undefined),
      },
    });
    await expect(svc.approve(ACTOR, INVITE_ID)).rejects.toBeInstanceOf(ConflictException);
  });
});

// ── reject ────────────────────────────────────────────────────────────────

describe("reject", () => {
  it("không tìm thấy → NotFound", async () => {
    const { svc } = makeService({ repo: { findByIdTx: vi.fn().mockResolvedValue(undefined) } });
    await expect(svc.reject(ACTOR, INVITE_ID)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("status terminal (approved) → BadRequest", async () => {
    const { svc } = makeService({
      repo: { findByIdTx: vi.fn().mockResolvedValue(inviteRow({ status: "approved" })) },
    });
    await expect(svc.reject(ACTOR, INVITE_ID)).rejects.toBeInstanceOf(BadRequestException);
  });

  it("pending → rejected + audit", async () => {
    const pending = inviteRow({ status: "pending" });
    const rejected = inviteRow({ status: "rejected" });
    const { svc, audit } = makeService({
      repo: {
        findByIdTx: vi.fn().mockResolvedValue(pending),
        markRejectedTx: vi.fn().mockResolvedValue(rejected),
      },
    });
    const res = await svc.reject(ACTOR, INVITE_ID);
    expect(audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "invite.rejected" }),
    );
    expect(res.status).toBe("rejected");
  });
});

// ── listPending ──────────────────────────────────────────────────────────

describe("listPending", () => {
  it("map DTO KHÔNG token_hash/password_hash", async () => {
    const { svc } = makeService({
      repo: {
        listQueue: vi
          .fn()
          .mockResolvedValue([inviteRow(), inviteRow({ status: "accepted", passwordHash: "H" })]),
      },
    });
    const { invites } = await svc.listPending(COMPANY);
    expect(invites).toHaveLength(2);
    for (const inv of invites) {
      expect(inv).not.toHaveProperty("tokenHash");
      expect(inv).not.toHaveProperty("passwordHash");
    }
  });
});

beforeEach(() => vi.clearAllMocks());
