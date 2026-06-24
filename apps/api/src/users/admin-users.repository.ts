import { Injectable } from "@nestjs/common";
import { and, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";
import { users, type User } from "../db/schema";
import type { UserStatus } from "@mediaos/contracts";

/**
 * ACCT-2 AdminUsersRepository — data-access admin user CRUD. MỌI truy vấn TRONG tx của caller (withTenant)
 * + WHERE company_id tường minh (phòng thủ kép trên RLS — BẤT BIẾN #1). SELECT cột TƯỜNG MINH (KHÔNG
 * SELECT * → KHÔNG kéo password_hash ra). soft-delete = set deleted_at + status, KHÔNG tx.delete (BẤT BIẾN #2).
 */

/** Cột non-secret cho snapshot audit (KHÔNG passwordHash — BẤT BIẾN #3). */
export function adminUserSnapshot(row: User | undefined | null) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    fullName: row.fullName,
    status: row.status,
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  };
}

export interface ListUsersFilter {
  status?: UserStatus;
  q?: string;
  limit: number;
  offset: number;
}

@Injectable()
export class AdminUsersRepository {
  /** Danh sách user LIVE (deleted_at IS NULL) + tổng (cho pagination). Mới nhất trước. */
  async findManyTx(
    tx: TenantTx,
    companyId: string,
    filter: ListUsersFilter,
  ): Promise<{ rows: User[]; total: number }> {
    const conds: SQL[] = [eq(users.companyId, companyId), isNull(users.deletedAt)];
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

  /** 1 user theo id (mặc định CHỈ live). includeDeleted=true để đọc cả đã xoá-mềm. */
  findByIdTx(
    tx: TenantTx,
    companyId: string,
    id: string,
    includeDeleted = false,
  ): Promise<User | undefined> {
    const conds: SQL[] = [eq(users.companyId, companyId), eq(users.id, id)];
    if (!includeDeleted) conds.push(isNull(users.deletedAt));
    return tx
      .select()
      .from(users)
      .where(and(...conds))
      .limit(1)
      .then((r) => r[0]);
  }

  /** Cập nhật hồ sơ (fullName) — CHỈ user LIVE. Trả row sau cập nhật (undefined nếu không khớp). */
  updateProfileTx(
    tx: TenantTx,
    companyId: string,
    id: string,
    fullName: string,
  ): Promise<User | undefined> {
    return tx
      .update(users)
      .set({ fullName, updatedAt: new Date() })
      .where(and(eq(users.companyId, companyId), eq(users.id, id), isNull(users.deletedAt)))
      .returning()
      .then((r) => r[0]);
  }

  /** Đổi status (suspend/reactivate) — CHỈ user LIVE. Trả row sau cập nhật. */
  setStatusTx(
    tx: TenantTx,
    companyId: string,
    id: string,
    status: UserStatus,
  ): Promise<User | undefined> {
    return tx
      .update(users)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(users.companyId, companyId), eq(users.id, id), isNull(users.deletedAt)))
      .returning()
      .then((r) => r[0]);
  }

  /**
   * Xoá-MỀM: set deleted_at + status='suspended' (chặn login qua deleted_at filter sẵn có ở auth). CHỈ khi
   * đang LIVE (deleted_at IS NULL) → idempotent + 0 row nếu đã xoá (caller → NotFound). KHÔNG tx.delete
   * (BẤT BIẾN #2 — không hard-delete). Trả row sau cập nhật (undefined nếu không khớp).
   */
  softDeleteTx(tx: TenantTx, companyId: string, id: string): Promise<User | undefined> {
    const now = new Date();
    return tx
      .update(users)
      .set({ deletedAt: now, status: "suspended", updatedAt: now })
      .where(and(eq(users.companyId, companyId), eq(users.id, id), isNull(users.deletedAt)))
      .returning()
      .then((r) => r[0]);
  }
}
