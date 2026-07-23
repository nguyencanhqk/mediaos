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

/** Thay đổi chưa ghi được audit, chờ nhịp sau ghi bù (chỉ ĐẾM — không PII). */
interface PendingChanged {
  created: number;
  reactivated: number;
  deactivated: number;
}

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
  /**
   * companyId → thay đổi ĐÃ XẢY RA nhưng CHƯA ghi được audit (`audit.record` ném). Nhịp sau cộng dồn
   * vào và ghi bù.
   *
   * Vì sao cần (silent-failure-hunter F1): thay đổi là sự kiện NHẤT THỜI, còn LMS thì idempotent — nhịp
   * sau `created`/`deactivated` đã thành `existing`/`alreadyDisabled` ⇒ `changed=0` ⇒ KHÔNG có nhịp nào
   * tái tạo được dòng audit đã mất. Khác hẳn nhánh `abnormal` (trạng thái BỀN, tự retry mỗi nhịp).
   * `audit_logs` append-only nên mất là mất vĩnh viễn.
   */
  private readonly pendingChanged = new Map<string, PendingChanged>();
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
        // Siết tới từng counter (không chỉ `!s`): object thiếu field ⇒ `created += undefined` ⇒ NaN ⇒
        // `NaN > 0` false ⇒ IM LẶNG không audit. Hôm nay không tới được (LmsHttpClient luôn dựng từ
        // zeroSummary) nhưng `http as never` ở test khiến TS không gác — cùng họ lỗi đã phòng ở trên.
        if (
          !s ||
          s.unknown ||
          !Number.isInteger(s.created) ||
          !Number.isInteger(s.reactivated) ||
          !Number.isInteger(s.deactivated)
        ) {
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
    // Cộng lại phần nợ của nhịp trước (audit ghi hỏng) TRƯỚC khi tính `changed` — xem `pendingChanged`.
    const carried = this.pendingChanged.get(companyId);
    created += carried?.created ?? 0;
    reactivated += carried?.reactivated ?? 0;
    deactivated += carried?.deactivated ?? 0;

    const changed = created + reactivated + deactivated;
    const abnormal = failed > 0 || anyUnknown;
    const now = Date.now();
    const last = this.abnormalAuditedAt.get(companyId);
    const wasAbnormal = last !== undefined;

    // (3a) QUYẾT ĐỊNH — thuần đọc, KHÔNG đụng state.
    let auditPhase: AuditPhase | null = null;
    if (changed > 0) auditPhase = "changed";
    else if (abnormal && (!wasAbnormal || now - last >= ABNORMAL_REAUDIT_MS))
      auditPhase = "abnormal";
    else if (!abnormal && wasAbnormal) auditPhase = "recovered";

    // (3b) GHI TRƯỚC, cập nhật state SAU. Thứ tự bắt buộc: nếu đánh dấu "đã audit" trước mà `record`
    // ném (DB nghẽn / thiếu mig 0509), ta mất dấu vết SUỐT 1 GIỜ mà không ai biết.
    if (auditPhase !== null) {
      try {
        await this.db.withTenant(companyId, (tx) =>
          this.audit.record(tx, {
            action: "lms_user_sync",
            objectType: "lms_sync",
            actorType: "Job",
            actionGroup: "INTEGRATION",
            // `unknown` KHÔNG được báo là Success: sự cố phổ biến nhất (LMS trả 200 + body rác) có
            // failed===0, nếu để Success thì mọi alert lọc theo cột trạng thái sẽ MÙ với nó — đúng loại
            // điểm mù WO này đi sửa. Dùng "Error" (≠ "Failure") để phân biệt "không xác minh được" với
            // "gọi hỏng".
            resultStatus: failed > 0 ? "Failure" : anyUnknown ? "Error" : "Success",
            // CHỈ ĐẾM + cờ hằng nội bộ — KHÔNG email, KHÔNG chuỗi từ nguồn ngoài.
            // Lưu ý người đọc: `created/reactivated/deactivated` là UNDER-COUNT khi `fail>0` (lô lỗi
            // không có summary) hoặc `unknown` (counter lô đó bị bỏ); `ok` đếm user đã GỬI ĐI thành
            // công (HTTP 2xx), KHÔNG phải "đã xác minh LMS áp xong" — cả 3 ca đều có cờ trên cùng dòng.
            metadata: {
              total,
              ok: success,
              fail: failed,
              created,
              reactivated,
              deactivated,
              unknown: anyUnknown,
              auditPhase,
              // Đóng ngoặc sự cố ĐỘC LẬP với `auditPhase`: khi hồi phục TRÙNG nhịp có thay đổi thì
              // nhãn là 'changed', không có dòng 'recovered' nào — query ghép cặp abnormal↔recovered
              // theo auditPhase sẽ thấy sự cố treo vĩnh viễn. Cờ này mới là thứ để đóng.
              recovered: !abnormal && wasAbnormal,
              // Dòng này có mang theo thay đổi của nhịp trước bị ghi hỏng hay không.
              carriedOver: carried !== undefined,
            },
          }),
        );
      } catch (err) {
        // Ghi audit hỏng ở pha `changed` = mất dấu vết VĨNH VIỄN (LMS idempotent ⇒ nhịp sau changed=0).
        // Đệm lại để nhịp sau ghi bù, rồi NÉM TIẾP để JobRunner đánh dấu Failed (sự cố phải nhìn thấy).
        if (changed > 0) {
          this.pendingChanged.set(companyId, { created, reactivated, deactivated });
        }
        throw err;
      }
      this.pendingChanged.delete(companyId);
      if (abnormal) this.abnormalAuditedAt.set(companyId, now);
      else this.abnormalAuditedAt.delete(companyId);
    }
    // Warn-once THEO SỰ CỐ, không phải theo vòng đời process: nếu không reset, sự cố unknown thứ hai
    // (tháng sau) sẽ không sinh log nào.
    if (!anyUnknown) this.warnedUnknown = false;

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
