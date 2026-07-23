import { Injectable, Logger } from "@nestjs/common";
import { and, eq, isNull, sql } from "drizzle-orm";
import { DatabaseService } from "../../db/db.service";
import { employeeProfiles } from "../../db/schema/employees";
import { users } from "../../db/schema/users";
import { AuditService } from "../../events/audit.service";
import {
  type JobHandler,
  type JobRunContext,
  type JobRunResult,
  SystemJobHandler,
} from "../../scheduler/job-handler";
import { LmsHttpClient, type LmsSyncUser } from "./lms-http-client.service";

export const LMS_USER_SYNC_JOB_CODE = "LMS_USER_SYNC";
const BATCH_SIZE = 100;

/**
 * S5-LMS-BE-1 — job đối soát định kỳ (backfill/self-heal): quét TOÀN BỘ user×employee_profiles của
 * LMS-company rồi upsert sang LMS (đường TẠO tài khoản mới mang `name`; tự lành khi event rớt / LMS down
 * lúc phát). Mirror `sync-lms-users.mjs` nhưng per-tenant qua JobRunner.
 *
 * BẤT BIẾN #1 — COMPANY GATE: JobRunner enumerate MỌI company; job CHỈ chạy cho `LMS_COMPANY_ID` (LMS là
 * hệ 1-công-ty; endpoint khoá thuần theo email). Tenant khác → early-return total:0 (KHÔNG query/POST/audit)
 * ⇒ email tenant khác KHÔNG rò sang LMS. Thiếu env → tắt sạch. Query AND company_id tường minh.
 *
 * BẤT BIẾN #3: audit `lms_sync` chỉ ghi ĐẾM (total/ok/fail) — KHÔNG dump email list. HTTP ngoài tx.
 */
@Injectable()
@SystemJobHandler()
export class LmsUserSyncJobHandler implements JobHandler {
  readonly jobCode = LMS_USER_SYNC_JOB_CODE;
  private readonly logger = new Logger(LmsUserSyncJobHandler.name);
  private readonly lmsCompanyId = process.env.LMS_COMPANY_ID ?? null;

  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly http: LmsHttpClient,
  ) {}

  async run(ctx: JobRunContext): Promise<JobRunResult> {
    const { companyId } = ctx;
    // Company gate + env gate: ngoài phạm vi → no-op sạch (KHÔNG query, KHÔNG POST, KHÔNG audit rác).
    if (!this.lmsCompanyId || companyId !== this.lmsCompanyId || !this.http.isEnabled()) {
      return { total: 0, success: 0, failed: 0 };
    }

    // (1) Đọc toàn bộ user trong phạm vi (tx đóng TRƯỚC khi gọi HTTP — không network trong tx).
    const rows = await this.db.withTenant(companyId, (tx) =>
      tx
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
        .where(and(eq(users.companyId, companyId), isNull(users.deletedAt))),
    );

    const total = rows.length;
    // (2) Upsert theo lô (đường TẠO account mang name). Đếm ok/fail theo lô — KHÔNG throw để giữ audit.
    let success = 0;
    let failed = 0;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch: LmsSyncUser[] = rows.slice(i, i + BATCH_SIZE).map((r) => ({
        email: r.email,
        name: r.name ?? undefined,
        active: Boolean(r.active),
      }));
      try {
        await this.http.syncUsers(batch);
        success += batch.length;
      } catch (err) {
        failed += batch.length;
        // KHÔNG log email/body (BẤT BIẾN #3) — chỉ message + số lượng lô.
        const message = err instanceof Error ? err.message : "unknown";
        this.logger.warn(
          `LMS reconcile lô ${i / BATCH_SIZE} (${batch.length} user) lỗi: ${message}`,
        );
      }
    }

    // (3) Audit summary (chỉ khi có việc thật) — ĐẾM, KHÔNG email list; actorType Job (không actor user).
    if (total > 0) {
      await this.db.withTenant(companyId, (tx) =>
        this.audit.record(tx, {
          action: "lms_user_sync",
          objectType: "lms_sync",
          actorType: "Job",
          actionGroup: "INTEGRATION",
          resultStatus: failed === 0 ? "Success" : "Failure",
          metadata: { total, ok: success, fail: failed },
        }),
      );
    }

    return { total, success, failed, metadata: { ok: success, fail: failed } };
  }
}
