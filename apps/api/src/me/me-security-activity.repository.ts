import { Injectable } from "@nestjs/common";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { unionAll } from "drizzle-orm/pg-core";
import type { TenantTx } from "../db/db.service";
import { loginLogs, userSecurityEvents } from "../db/schema/auth-logs";

/**
 * S5-ME-BE-3 — repository ĐỌC-CHỈ cho GET /me/security/activity (SPEC-09 ME-FUNC-016).
 *
 * OWN-SCOPE CỨNG: mọi method nhận `userId` = token-resolved và khoá `user_id = userId` NGAY TRONG SQL
 * cả 2 nhánh (chống IDOR §14.4 — actor-lock, KHÔNG nhận filter user tuỳ ý như viewer admin; bài học
 * memory `reused-method-must-be-actor-scoped`). Chạy TRONG withTenant của service (RLS + FORCE,
 * BẤT BIẾN #1). CHỈ SELECT/COUNT — login_logs/user_security_events append-only (BẤT BIẾN #2).
 *
 * KHÔNG SELECT cột jsonb `metadata`/`payload` (có thể chứa ngữ cảnh nhạy cảm) — field không tồn tại
 * trong row ⇒ không có đường lộ, mạnh hơn redact-at-read (BẤT BIẾN #3, mirror AuthLogsViewerService).
 * KHÔNG SELECT email/normalized_email/failure_reason/session_id/actor_user_id (DTO tối giản §17).
 *
 * Nhánh login_logs KHÔNG AND company_id tường minh: RLS nullable-tenant (USING own+NULL) CỐ Ý cho
 * row company NULL đi qua — fail đăng nhập pre-auth của CHÍNH user vẫn phải hiện; actor-lock
 * `user_id = userId` là hàng rào chống rò user khác (row NULL-company user lạ bị chặn — plan §2.4).
 * Nhánh user_security_events AND company_id tường minh (belt-and-suspenders, company NOT NULL).
 */

/** 1 dòng activity đã hợp nhất 2 nguồn — CHƯA mask (service mask IP + rút gọn UA trước khi ra DTO). */
export interface MeSecurityActivityRow {
  id: string;
  source: string;
  eventType: string;
  severity: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
}

@Injectable()
export class MeSecurityActivityRepository {
  /** Map login_status (lowercase chuẩn codebase) → mã sự kiện hiển thị. */
  private loginEventTypeSql() {
    return sql<string>`CASE ${loginLogs.loginStatus}
      WHEN 'success' THEN 'LOGIN_SUCCESS'
      WHEN 'failed' THEN 'LOGIN_FAILED'
      WHEN 'blocked' THEN 'LOGIN_BLOCKED'
      ELSE 'LOGIN' END`.as("event_type");
  }

  private loginWhere(userId: string, from: Date, to: Date) {
    return and(
      eq(loginLogs.userId, userId),
      gte(loginLogs.createdAt, from),
      lte(loginLogs.createdAt, to),
    );
  }

  private eventWhere(companyId: string, userId: string, from: Date, to: Date) {
    return and(
      eq(userSecurityEvents.companyId, companyId),
      eq(userSecurityEvents.userId, userId),
      gte(userSecurityEvents.createdAt, from),
      lte(userSecurityEvents.createdAt, to),
    );
  }

  /** 1 trang activity hợp nhất (UNION ALL trong SQL — phân trang merged đúng, KHÔNG merge in-memory). */
  async findPageTx(
    tx: TenantTx,
    companyId: string,
    userId: string,
    from: Date,
    to: Date,
    limit: number,
    offset: number,
  ): Promise<MeSecurityActivityRow[]> {
    const loginBranch = tx
      .select({
        id: loginLogs.id,
        source: sql<string>`'login'`.as("source"),
        eventType: this.loginEventTypeSql(),
        severity: sql<string | null>`NULL::text`.as("severity"),
        ipAddress: loginLogs.ipAddress,
        userAgent: loginLogs.userAgent,
        createdAt: loginLogs.createdAt,
      })
      .from(loginLogs)
      .where(this.loginWhere(userId, from, to));

    const eventBranch = tx
      .select({
        id: userSecurityEvents.id,
        source: sql<string>`'security_event'`.as("source"),
        eventType: sql<string>`${userSecurityEvents.eventType}`.as("event_type"),
        severity: sql<string | null>`${userSecurityEvents.severity}`.as("severity"),
        ipAddress: userSecurityEvents.ipAddress,
        userAgent: userSecurityEvents.userAgent,
        createdAt: userSecurityEvents.createdAt,
      })
      .from(userSecurityEvents)
      .where(this.eventWhere(companyId, userId, from, to));

    // ORDER BY cột output của union (created_at DESC, id DESC — tie-break ổn định giữa 2 nguồn).
    return unionAll(loginBranch, eventBranch)
      .orderBy(desc(sql`created_at`), desc(sql`id`))
      .limit(limit)
      .offset(offset);
  }

  /**
   * Tổng số dòng cho pagination — CÙNG bộ lọc (userId + [from, to]) với findPageTx (plan-review M1:
   * count lệch clamp ⇒ total/has_next sai). 2 count đơn bảng rẻ hơn count-over-union.
   */
  async countTx(
    tx: TenantTx,
    companyId: string,
    userId: string,
    from: Date,
    to: Date,
  ): Promise<number> {
    const [loginRows, eventRows] = await Promise.all([
      tx
        .select({ n: sql<number>`count(*)::int` })
        .from(loginLogs)
        .where(this.loginWhere(userId, from, to)),
      tx
        .select({ n: sql<number>`count(*)::int` })
        .from(userSecurityEvents)
        .where(this.eventWhere(companyId, userId, from, to)),
    ]);
    return (loginRows[0]?.n ?? 0) + (eventRows[0]?.n ?? 0);
  }
}
