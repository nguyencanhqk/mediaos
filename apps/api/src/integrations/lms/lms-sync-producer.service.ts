import { Injectable } from "@nestjs/common";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { TenantTx } from "../../db/db.service";
import { employeeProfiles } from "../../db/schema/employees";
import { users } from "../../db/schema/users";
import { OutboxService } from "../../events/outbox.service";

/** eventType RIÊNG cho auto-sync LMS — TÁCH KHỎI `auth.user_locked` (né consumer notification hiện có). */
export const LMS_ACCOUNT_SYNC_EVENT = "hr.employee_status_changed";

/** Payload whitelist đưa vào outbox — KHÔNG kéo row nhân sự, KHÔNG token/secret (BẤT BIẾN #3). */
export interface LmsAccountSyncPayload {
  email: string;
  name?: string;
  active: boolean;
  [key: string]: unknown;
}

/**
 * S5-LMS-BE-1 — producer auto-sync tài khoản MediaOS→LMS. Gọi TRONG tx nghiệp vụ (`withTenant`), SAU khi
 * mutation trạng thái đã áp, bởi `HrWriteService.changeStatus` và `AuthUsersService.lockUser/unlockUser`.
 *
 * CHỈ làm DB resolve + `OutboxService.enqueue` — **ZERO HTTP** (KHÔNG inject LmsHttpClient): LMS chết KHÔNG
 * BAO GIỜ chạm tx nghiệp vụ (fail-soft cấu trúc). Rollback tx ⇒ outbox event biến mất (transactional outbox).
 *
 * BẤT BIẾN #1 — COMPANY GATE: chỉ enqueue khi `companyId === LMS_COMPANY_ID` (LMS là hệ 1-công-ty; endpoint
 * khoá thuần theo email KHÔNG company-scope). Tenant khác / thiếu env → no-op ⇒ email KHÔNG rò sang LMS.
 * Resolve query AND `company_id` tường minh (không chỉ dựa RLS). INNER JOIN employee_profiles ⇒ chỉ user CÓ
 * hồ sơ nhân viên mới trong phạm vi (mirror sync-lms-users.mjs); user không hồ sơ (admin@…) → no-op sạch.
 */
@Injectable()
export class LmsSyncProducer {
  private readonly lmsCompanyId = process.env.LMS_COMPANY_ID ?? null;

  constructor(private readonly outbox: OutboxService) {}

  /**
   * Resolve `{email, name?, active}` cho `userId` trong `companyId` rồi enqueue nếu trong phạm vi.
   * No-op khi: companyId ≠ LMS_COMPANY_ID (hoặc env thiếu) · userId null · user không hồ sơ/đã xoá.
   */
  async enqueueSync(tx: TenantTx, companyId: string, userId: string | null): Promise<void> {
    if (!this.lmsCompanyId || companyId !== this.lmsCompanyId || !userId) return;

    const [row] = await tx
      .select({
        email: users.email,
        name: users.fullName,
        active: sql<boolean>`(${users.status} = 'active' AND ${employeeProfiles.status} = 'active')`,
      })
      .from(users)
      .innerJoin(
        employeeProfiles,
        and(eq(employeeProfiles.userId, users.id), isNull(employeeProfiles.deletedAt)),
      )
      .where(and(eq(users.id, userId), eq(users.companyId, companyId), isNull(users.deletedAt)))
      .limit(1);

    if (!row) return; // không hồ sơ / đã xoá → ngoài phạm vi LMS

    const payload: LmsAccountSyncPayload = { email: row.email, active: Boolean(row.active) };
    if (row.name) payload.name = row.name;

    await this.outbox.enqueue(tx, { eventType: LMS_ACCOUNT_SYNC_EVENT, payload });
  }
}
