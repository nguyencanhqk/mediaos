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
import { LmsHttpClient, type LmsSyncSummary, type LmsSyncUser } from "./lms-http-client.service";

export const LMS_USER_SYNC_JOB_CODE = "LMS_USER_SYNC";
const BATCH_SIZE = 100;

/** Trần nhắc lại khi trạng thái bất thường BÁM DAI (S5-LMS-BE-4 §3B1). */
const ABNORMAL_REAUDIT_MS = 60 * 60 * 1000;

/**
 * Loại dòng audit — literal union, CẤM khai `string`: rủi ro không ở "kiểu chuỗi" mà ở XUẤT XỨ. Union
 * khiến một chuỗi lấy từ body LMS KHÔNG THỂ gán vào được (trình biên dịch làm người gác).
 */
type AuditPhase = "changed" | "abnormal" | "recovered";

/**
 * S5-LMS-BE-1 — job đối soát định kỳ (backfill/self-heal): quét TOÀN BỘ user×employee_profiles của
 * LMS-company rồi upsert sang LMS (đường TẠO tài khoản mới mang `name`; tự lành khi event rớt / LMS down
 * lúc phát). Mirror `sync-lms-users.mjs` nhưng per-tenant qua JobRunner.
 *
 * BẤT BIẾN #1 — COMPANY GATE: JobRunner enumerate MỌI company; job CHỈ chạy cho `LMS_COMPANY_ID` (LMS là
 * hệ 1-công-ty; endpoint khoá thuần theo email). Tenant khác → early-return total:0 (KHÔNG query/POST/audit)
 * ⇒ email tenant khác KHÔNG rò sang LMS. Thiếu env → tắt sạch. Query AND company_id tường minh.
 *
 * BẤT BIẾN #3: audit `lms_sync` chỉ ghi ĐẾM + cờ — KHÔNG dump email list. HTTP ngoài tx.
 *
 * S5-LMS-BE-4 — audit CÓ ĐIỀU KIỆN. Trước đây điều kiện là `total > 0` (= số user công ty, LUÔN đúng)
 * nên job ghi 1 dòng `audit_logs` MỖI NHỊP scheduler (60s) ⇒ ~526k dòng/năm rác trong bảng APPEND-ONLY
 * (không dọn được — BẤT BIẾN #2). Nay:
 *   · `changed > 0` (created/reactivated/deactivated) → audit MỖI LẦN, không trần: số thay đổi thật
 *     đã tự giới hạn, và khoá/mở tài khoản là sự kiện an ninh không được bỏ.
 *   · bất thường (`failed > 0` hoặc `unknown`) là TRẠNG THÁI BỀN chứ không phải sự kiện ⇒ audit theo
 *     CHUYỂN TRẠNG THÁI + trần ≤1 dòng/giờ/company, kèm 1 dòng `recovered` đóng ngoặc sự cố.
 *     Không có trần thì LMS chết bền = audit mỗi 60s = đúng quả bom vừa đi gỡ.
 *   · Bằng chứng "job đã chạy" mỗi nhịp KHÔNG mất: `system_job_runs` ghi đủ (job-runner.ts).
 */
@Injectable()
@SystemJobHandler()
export class LmsUserSyncJobHandler implements JobHandler {
  readonly jobCode = LMS_USER_SYNC_JOB_CODE;
  private readonly logger = new Logger(LmsUserSyncJobHandler.name);
  private readonly lmsCompanyId = process.env.LMS_COMPANY_ID ?? null;
  /** companyId → thời điểm dòng audit BẤT THƯỜNG gần nhất. Vắng key = đang bình thường. */
  private readonly abnormalAuditedAt = new Map<string, number>();
  private warnedUnknown = false;

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
    //
    // BA TRẠNG THÁI LÔ, KHÔNG chồng lấn:
    //   lô THROW           → failed += batch.length      (lỗi mạng/HTTP — KHÔNG phải `unknown`)
    //   lô ok, parse ĐƯỢC  → cộng 6 counter vào tổng
    //   lô ok, parse KHÔNG → anyUnknown = true, counter của lô BỊ BỎ HOÀN TOÀN
    // Bỏ hẳn counter của lô `unknown` là điều bắt buộc: nếu vẫn cộng, một LMS drift vừa làm lệch tổng
    // vừa báo `deactivated:1` mỗi nhịp sẽ khiến `changed>0` mỗi nhịp ⇒ ĐI VÒNG QUA TRẦN bên dưới.
    let success = 0;
    let failed = 0;
    let created = 0;
    let reactivated = 0;
    let deactivated = 0;
    let anyUnknown = false;

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch: LmsSyncUser[] = rows.slice(i, i + BATCH_SIZE).map((r) => ({
        email: r.email,
        name: r.name ?? undefined,
        active: Boolean(r.active),
      }));
      try {
        const s: LmsSyncSummary | undefined | null = await this.http.syncUsers(batch);
        success += batch.length;
        // Giá trị trả về undefined/null (mock cũ, lỗi lập trình) → coi là unknown TRƯỚC khi đụng field.
        // Nếu không, TypeError sẽ bị catch bên dưới nuốt ⇒ đếm nhầm `failed` + Failure oan (nguỵ trang
        // lỗi lập trình thành lỗi mạng).
        if (!s || s.unknown) {
          anyUnknown = true;
        } else {
          created += s.created;
          reactivated += s.reactivated;
          deactivated += s.deactivated;
        }
      } catch (err) {
        failed += batch.length;
        // KHÔNG log email/body (BẤT BIẾN #3) — chỉ message + số lượng lô.
        const message = err instanceof Error ? err.message : "unknown";
        this.logger.warn(
          `LMS reconcile lô ${i / BATCH_SIZE} (${batch.length} user) lỗi: ${message}`,
        );
      }
    }

    if (anyUnknown && !this.warnedUnknown) {
      this.logger.warn(
        "LMS sync: không đọc được summary (unknown) — audit chuyển sang fail-safe, kiểm shape response LMS.",
      );
      this.warnedUnknown = true;
    }

    // (3) Audit CÓ ĐIỀU KIỆN.
    const changed = created + reactivated + deactivated;
    const abnormal = failed > 0 || anyUnknown;
    const now = Date.now();
    const last = this.abnormalAuditedAt.get(companyId);
    const wasAbnormal = last !== undefined;

    // (3a) QUYẾT ĐỊNH — thuần đọc, KHÔNG đụng state.
    let auditPhase: AuditPhase | null = null;
    if (changed > 0) auditPhase = "changed";
    else if (abnormal && (!wasAbnormal || now - last >= ABNORMAL_REAUDIT_MS)) auditPhase = "abnormal";
    else if (!abnormal && wasAbnormal) auditPhase = "recovered";

    // (3b) GHI TRƯỚC, cập nhật state SAU. Thứ tự bắt buộc: nếu đánh dấu "đã audit" trước mà `record`
    // ném (DB nghẽn / thiếu mig 0509), ta mất dấu vết SUỐT 1 GIỜ mà không ai biết.
    if (auditPhase !== null) {
      await this.db.withTenant(companyId, (tx) =>
        this.audit.record(tx, {
          action: "lms_user_sync",
          objectType: "lms_sync",
          actorType: "Job",
          actionGroup: "INTEGRATION",
          resultStatus: failed === 0 ? "Success" : "Failure",
          // CHỈ ĐẾM + cờ hằng nội bộ — KHÔNG email, KHÔNG chuỗi từ nguồn ngoài.
          // Lưu ý người đọc: `created/reactivated/deactivated` là UNDER-COUNT khi `fail>0` (lô lỗi không
          // có summary) hoặc `unknown` (counter lô đó bị bỏ) — cả hai đều có cờ ngay trên cùng dòng.
          metadata: {
            total,
            ok: success,
            fail: failed,
            created,
            reactivated,
            deactivated,
            unknown: anyUnknown,
            auditPhase,
          },
        }),
      );
      if (abnormal) this.abnormalAuditedAt.set(companyId, now);
      else this.abnormalAuditedAt.delete(companyId);
    }

    return {
      total,
      success,
      failed,
      metadata: {
        ok: success,
        fail: failed,
        created,
        reactivated,
        deactivated,
        unknown: anyUnknown,
      },
    };
  }
}
