import { Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";
import { userPreferences, type UserPreference } from "../db/schema";

/**
 * S5-ME-BE-2 — persistence cho `user_preferences` (DB-08 §8.16 / mig 0495). MỌI method nhận `tx` từ
 * `withTenant(actor.companyId)` của service gọi (RLS + FORCE, BẤT BIẾN #1) + AND `company_id` tường minh
 * (belt-and-suspenders). Khoá theo `userId` **token-resolved** (KHÔNG bao giờ từ client) — RLS chỉ cô lập
 * TENANT (mig 0495 note "CROSS-USER KHÔNG DO RLS"), chống IDOR cross-user PHẢI ép ở đây (SPEC-09 §14.4).
 */

/** Field cho phép upsert — Partial: field vắng (`undefined`) = KHÔNG đụng cột đó (Drizzle bỏ qua). */
export interface MePreferencesPatchColumns {
  locale?: string | null;
  timezone?: string | null;
  theme?: string | null;
  dateFormat?: string | null;
  timeFormat?: string | null;
  defaultLanding?: string | null;
  density?: string | null;
  favoriteModules?: string[] | null;
  meLayoutConfig?: Record<string, unknown> | null;
}

@Injectable()
export class MePreferencesRepository {
  /** Bản ghi preference của CHÍNH user (own, khoá `userId` token-resolved). undefined = chưa có (mọi field mặc định inherit). */
  async findByUserTx(
    tx: TenantTx,
    companyId: string,
    userId: string,
  ): Promise<UserPreference | undefined> {
    const [row] = await tx
      .select()
      .from(userPreferences)
      .where(and(eq(userPreferences.companyId, companyId), eq(userPreferences.userId, userId)))
      .limit(1);
    return row;
  }

  /**
   * Upsert theo UNIQUE(company_id,user_id) (mig 0495) — PARTIAL: chỉ field CÓ trong `patch` bị đụng, field
   * vắng giữ nguyên giá trị cũ (mirror `HrWriteRepository.updateTx` — spread trực tiếp vào `.set()`, Drizzle
   * bỏ qua key `undefined`). Lần đầu (INSERT) field vắng = DB default (NULL — inherit).
   */
  async upsertTx(
    tx: TenantTx,
    companyId: string,
    userId: string,
    patch: MePreferencesPatchColumns,
    actorUserId: string,
  ): Promise<UserPreference> {
    const [row] = await tx
      .insert(userPreferences)
      .values({ companyId, userId, ...patch, createdBy: actorUserId, updatedBy: actorUserId })
      .onConflictDoUpdate({
        target: [userPreferences.companyId, userPreferences.userId],
        set: { ...patch, updatedAt: new Date(), updatedBy: actorUserId },
      })
      .returning();
    if (!row) {
      throw new Error("MePreferencesRepository.upsertTx: upsert returned no row");
    }
    return row;
  }
}
