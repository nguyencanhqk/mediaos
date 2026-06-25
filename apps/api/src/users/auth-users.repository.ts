import { Injectable } from "@nestjs/common";
import { and, desc, eq, ilike, isNull, or, sql, type SQL } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";
import { users, type User } from "../db/schema";
import type { AuthUserStatus } from "@mediaos/contracts";

/**
 * S2-AUTH-BE-3 AuthUsersRepository — data-access cho /auth/users (list/get/create/update/lock/unlock).
 *
 * BẤT BIẾN #1: MỌI truy vấn TRONG tx của caller (withTenant) + WHERE company_id tường minh (phòng thủ
 * kép trên RLS) + scope predicate do service truyền vào (data-scope-aware, KHÔNG bao giờ match-all).
 * BẤT BIẾN #3: SELECT cột TƯỜNG MINH (KHÔNG password_hash/normalized_email) → DTO không bao giờ kéo
 * secret ra. BẤT BIẾN #2: lock/unlock/update = soft-mutate cột (KHÔNG hard-delete).
 */

/** Cột non-secret cho snapshot audit (KHÔNG passwordHash — BẤT BIẾN #3). */
export function authUserSnapshot(row: User | undefined | null) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    fullName: row.fullName,
    status: row.status,
    lockedAt: row.lockedAt ? row.lockedAt.toISOString() : null,
    lockedReason: row.lockedReason ?? null,
  };
}

export interface ListAuthUsersFilter {
  status?: AuthUserStatus;
  q?: string;
  limit: number;
  offset: number;
}

@Injectable()
export class AuthUsersRepository {
  /**
   * Danh sách user LIVE (deleted_at IS NULL) + tổng. `scope` = predicate data-scope do service dựng
   * (đã chứa company_id) — ANDed vào WHERE để bound rows; KHÔNG bao giờ gọi mà thiếu scope (fail-closed
   * `sql\`false\`` ở service khi scope null). Mới nhất trước.
   */
  async findManyTx(
    tx: TenantTx,
    companyId: string,
    scope: SQL,
    filter: ListAuthUsersFilter,
  ): Promise<{ rows: User[]; total: number }> {
    const conds: SQL[] = [eq(users.companyId, companyId), isNull(users.deletedAt), scope];
    if (filter.status) conds.push(eq(users.status, filter.status));
    if (filter.q) {
      const pattern = `%${filter.q}%`;
      const like = or(ilike(users.email, pattern), ilike(users.fullName, pattern));
      if (like) conds.push(like);
    }
    const where = and(...conds);

    const rows = await tx
      .select()
      .from(users)
      .where(where)
      .orderBy(desc(users.createdAt))
      .limit(filter.limit)
      .offset(filter.offset);

    const [{ n }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(users)
      .where(where);

    return { rows, total: n };
  }

  /** 1 user theo id (CHỈ live). Cross-tenant: RLS + WHERE company_id ⇒ undefined (caller → NotFound). */
  findByIdTx(tx: TenantTx, companyId: string, id: string): Promise<User | undefined> {
    return tx
      .select()
      .from(users)
      .where(and(eq(users.companyId, companyId), eq(users.id, id), isNull(users.deletedAt)))
      .limit(1)
      .then((r) => r[0]);
  }

  /** Email đã tồn tại trong tenant (chặn trùng khi tạo). CHỈ live. */
  emailExistsTx(tx: TenantTx, companyId: string, email: string): Promise<boolean> {
    return tx
      .select({ id: users.id })
      .from(users)
      .where(
        and(eq(users.companyId, companyId), ilike(users.email, email), isNull(users.deletedAt)),
      )
      .limit(1)
      .then((r) => r.length > 0);
  }

  /**
   * Tạo user. `passwordHash` = ĐÃ hash ở service (BẤT BIẾN #3 — repo KHÔNG nhận plaintext). company_id
   * truyền tường minh (RLS WITH CHECK + DB DEFAULT current_setting đều khớp). status mặc định 'active'.
   */
  createTx(
    tx: TenantTx,
    companyId: string,
    data: { email: string; passwordHash: string; fullName: string; createdBy: string },
  ): Promise<User> {
    return tx
      .insert(users)
      .values({
        companyId,
        email: data.email,
        passwordHash: data.passwordHash,
        fullName: data.fullName,
        createdBy: data.createdBy,
        updatedBy: data.createdBy,
      })
      .returning()
      .then((r) => r[0]);
  }

  /** Cập nhật hồ sơ (fullName) — CHỈ user LIVE. Trả row sau cập nhật (undefined nếu không khớp). */
  updateProfileTx(
    tx: TenantTx,
    companyId: string,
    id: string,
    fullName: string,
    updatedBy: string,
  ): Promise<User | undefined> {
    return tx
      .update(users)
      .set({ fullName, updatedBy, updatedAt: new Date() })
      .where(and(eq(users.companyId, companyId), eq(users.id, id), isNull(users.deletedAt)))
      .returning()
      .then((r) => r[0]);
  }

  /**
   * Khoá: status='locked' + lockedAt=now + lockedReason. Chặn login qua allow-list status==='active'
   * (AuthService) sẵn có. CHỈ user LIVE. Trả row sau cập nhật (undefined nếu không khớp).
   */
  setLockTx(
    tx: TenantTx,
    companyId: string,
    id: string,
    updatedBy: string,
    reason: string | null,
  ): Promise<User | undefined> {
    const now = new Date();
    return tx
      .update(users)
      .set({ status: "locked", lockedAt: now, lockedReason: reason, updatedBy, updatedAt: now })
      .where(and(eq(users.companyId, companyId), eq(users.id, id), isNull(users.deletedAt)))
      .returning()
      .then((r) => r[0]);
  }

  /** Mở khoá: status='active' + clear lockedAt/lockedReason. CHỈ user LIVE. Trả row sau cập nhật. */
  setUnlockTx(
    tx: TenantTx,
    companyId: string,
    id: string,
    updatedBy: string,
  ): Promise<User | undefined> {
    return tx
      .update(users)
      .set({
        status: "active",
        lockedAt: null,
        lockedReason: null,
        updatedBy,
        updatedAt: new Date(),
      })
      .where(and(eq(users.companyId, companyId), eq(users.id, id), isNull(users.deletedAt)))
      .returning()
      .then((r) => r[0]);
  }
}
