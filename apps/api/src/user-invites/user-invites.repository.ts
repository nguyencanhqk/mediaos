import { Injectable } from "@nestjs/common";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { companies, userInvites, users, type UserInvite } from "../db/schema";

/** Cột non-secret để snapshot audit (KHÔNG token_hash / password_hash — BẤT BIẾN #3). */
export function inviteAuditSnapshot(row: UserInvite | undefined | null) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    fullName: row.fullName,
    status: row.status,
    expiresAt: row.expiresAt.toISOString(),
    acceptedAt: row.acceptedAt ? row.acceptedAt.toISOString() : null,
    createdUserId: row.createdUserId,
  };
}

export interface NewInviteFields {
  email: string;
  fullName: string;
  tokenHash: string;
  expiresAt: Date;
  invitedBy: string;
}

/** Trạng thái coi là "đang hoạt động" — chặn mời trùng (pending hoặc accepted chờ duyệt). */
const ACTIVE_INVITE_STATUSES = ["pending", "accepted"] as const;

@Injectable()
export class UserInvitesRepository {
  constructor(private readonly db: DatabaseService) {}

  /** INSERT lời mời mới (status 'pending'). Trong tx caller để cùng commit audit. */
  insertTx(tx: TenantTx, companyId: string, fields: NewInviteFields): Promise<UserInvite> {
    return tx
      .insert(userInvites)
      .values({
        companyId,
        email: fields.email,
        fullName: fields.fullName,
        tokenHash: fields.tokenHash,
        status: "pending",
        expiresAt: fields.expiresAt,
        invitedBy: fields.invitedBy,
      })
      .returning()
      .then((rows) => rows[0]);
  }

  /** Lời mời đang hoạt động (pending|accepted) theo email (case-insensitive) — chặn mời trùng. */
  findActiveByEmailTx(
    tx: TenantTx,
    companyId: string,
    email: string,
  ): Promise<UserInvite | undefined> {
    return tx
      .select()
      .from(userInvites)
      .where(
        and(
          eq(userInvites.companyId, companyId),
          eq(sql`lower(${userInvites.email})`, email.toLowerCase()),
          inArray(userInvites.status, [...ACTIVE_INVITE_STATUSES]),
        ),
      )
      .limit(1)
      .then((rows) => rows[0]);
  }

  /** Tài khoản users đang sống theo email (case-insensitive) — chặn mời người đã có tài khoản. */
  findLiveUserByEmailTx(
    tx: TenantTx,
    companyId: string,
    email: string,
  ): Promise<{ id: string } | undefined> {
    return tx
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.companyId, companyId),
          eq(sql`lower(${users.email})`, email.toLowerCase()),
          isNull(users.deletedAt),
        ),
      )
      .limit(1)
      .then((rows) => rows[0]);
  }

  /** Tìm lời mời theo token_hash (lookup accept). KHÔNG lọc status/hết-hạn ở đây — service quyết. */
  findByTokenHashTx(
    tx: TenantTx,
    companyId: string,
    tokenHash: string,
  ): Promise<UserInvite | undefined> {
    return tx
      .select()
      .from(userInvites)
      .where(and(eq(userInvites.companyId, companyId), eq(userInvites.tokenHash, tokenHash)))
      .limit(1)
      .then((rows) => rows[0]);
  }

  /** Đọc slug + tên công ty (để dựng link kích hoạt trong email). */
  findCompanyTx(
    tx: TenantTx,
    companyId: string,
  ): Promise<{ slug: string; name: string } | undefined> {
    return tx
      .select({ slug: companies.slug, name: companies.name })
      .from(companies)
      .where(eq(companies.id, companyId))
      .limit(1)
      .then((rows) => rows[0]);
  }

  /** Đọc 1 lời mời theo id (cho approve/reject). */
  findByIdTx(tx: TenantTx, companyId: string, id: string): Promise<UserInvite | undefined> {
    return tx
      .select()
      .from(userInvites)
      .where(and(eq(userInvites.companyId, companyId), eq(userInvites.id, id)))
      .limit(1)
      .then((rows) => rows[0]);
  }

  /** Hàng đợi: lời mời pending + accepted (FE chia tab theo status). Mới nhất trước. */
  listQueue(companyId: string): Promise<UserInvite[]> {
    return this.db.withTenant(companyId, (tx) =>
      tx
        .select()
        .from(userInvites)
        .where(
          and(
            eq(userInvites.companyId, companyId),
            inArray(userInvites.status, [...ACTIVE_INVITE_STATUSES]),
          ),
        )
        .orderBy(desc(userInvites.createdAt)),
    );
  }

  /** accept: lưu password_hash + status 'accepted' + accepted_at (single-use). Trong tx caller. */
  markAcceptedTx(
    tx: TenantTx,
    companyId: string,
    id: string,
    passwordHash: string,
    acceptedAt: Date,
  ): Promise<UserInvite | undefined> {
    return tx
      .update(userInvites)
      .set({ status: "accepted", passwordHash, acceptedAt, updatedAt: new Date() })
      .where(
        and(
          eq(userInvites.companyId, companyId),
          eq(userInvites.id, id),
          eq(userInvites.status, "pending"),
          isNull(userInvites.acceptedAt),
        ),
      )
      .returning()
      .then((rows) => rows[0]);
  }

  /** approve: gắn user vừa tạo + status 'approved'. CHỈ khi đang 'accepted' (guard chống double-approve). */
  markApprovedTx(
    tx: TenantTx,
    companyId: string,
    id: string,
    createdUserId: string,
  ): Promise<UserInvite | undefined> {
    return tx
      .update(userInvites)
      .set({ status: "approved", createdUserId, updatedAt: new Date() })
      .where(
        and(
          eq(userInvites.companyId, companyId),
          eq(userInvites.id, id),
          eq(userInvites.status, "accepted"),
        ),
      )
      .returning()
      .then((rows) => rows[0]);
  }

  /** reject: status 'rejected'. CHỈ khi đang pending|accepted. */
  markRejectedTx(tx: TenantTx, companyId: string, id: string): Promise<UserInvite | undefined> {
    return tx
      .update(userInvites)
      .set({ status: "rejected", updatedAt: new Date() })
      .where(
        and(
          eq(userInvites.companyId, companyId),
          eq(userInvites.id, id),
          inArray(userInvites.status, [...ACTIVE_INVITE_STATUSES]),
        ),
      )
      .returning()
      .then((rows) => rows[0]);
  }

  /** Tạo tài khoản users (ACTIVE) khi admin duyệt — mirror employees.createUserTx. */
  createUserTx(
    tx: TenantTx,
    companyId: string,
    data: { email: string; fullName: string; passwordHash: string },
  ): Promise<{ id: string } | undefined> {
    return tx
      .insert(users)
      .values({
        companyId,
        email: data.email,
        fullName: data.fullName,
        passwordHash: data.passwordHash,
        status: "active",
      })
      .returning({ id: users.id })
      .then((rows) => rows[0]);
  }
}
