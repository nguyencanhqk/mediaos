import { Injectable } from "@nestjs/common";
import { and, eq, isNull } from "drizzle-orm";
import { DatabaseService } from "../db/db.service";
import { users } from "../db/schema";
import { AuditService } from "../events/audit.service";

/**
 * UsersService — Module 2a: self-service hồ sơ người dùng. Nền cho Module 2b (admin user CRUD).
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly dbsvc: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Cập nhật hồ sơ của CHÍNH user (full_name). RLS `withTenant(companyId)` + `WHERE id = self` ⇒ về CẤU TRÚC
   * KHÔNG thể chạm user khác / tenant khác (BẤT BIẾN #1). User đã xoá mềm / không thấy → no-op êm (không lộ).
   * Audit ghi TRONG cùng tx (append-only, cùng commit/rollback — BẤT BIẾN #2).
   */
  async updateOwnProfile(user: { id: string; companyId: string }, fullName: string): Promise<void> {
    await this.dbsvc.withTenant(user.companyId, async (tx) => {
      const updated = await tx
        .update(users)
        .set({ fullName, updatedAt: new Date() })
        .where(and(eq(users.id, user.id), isNull(users.deletedAt)))
        .returning({ id: users.id });
      if (updated.length === 0) return; // không có hàng (xoá mềm / id lạ) → không audit
      await this.audit.record(tx, {
        action: "user.profile_updated",
        objectType: "user",
        actorUserId: user.id,
        objectId: user.id,
        after: { fullName },
      });
    });
  }
}
