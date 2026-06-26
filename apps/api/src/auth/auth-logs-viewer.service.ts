import { Injectable } from "@nestjs/common";
import type {
  AuthLogUserRef,
  LoginLogListItem,
  LoginLogListQuery,
  LoginLogStatus,
  SecurityEventListItem,
  SecurityEventListQuery,
  SecurityEventSeverity,
} from "@mediaos/contracts";
import { DatabaseService } from "../db/db.service";
import { LoginLogRepository, type LoginLogFilter, type LoginLogRow } from "./login-log.repository";
import {
  SecurityEventRepository,
  type SecurityEventFilter,
  type SecurityEventRow,
} from "./security-event.repository";

/** Trang kết quả + tổng (controller dựng block pagination API-01 §16.1 từ total/page/per_page). */
export interface AuthLogPage<T> {
  data: T[];
  total: number;
}

/**
 * AuthLogsViewerService (S2-AUTH-BE-5) — đọc CHỈ-ĐỌC login_logs + user_security_events theo Company-scope:
 * `withTenant(companyId)` → RLS ép chỉ thấy log của tenant hiện tại (BẤT BIẾN #1). Map row→DTO CHỈ phơi
 * field forensic an toàn (status/severity/ip/user_agent/reason + ref user/actor rút gọn).
 *
 * BẤT BIẾN #3 (không secret plaintext): cột jsonb `metadata` (login_logs) / `payload` (user_security_events)
 * có thể chứa token/secret theo ngữ cảnh → repo KHÔNG select, service KHÔNG map. Đây là cách che MẠNH HƠN
 * redact-at-read (field không tồn tại trong DTO ⇒ không có đường lộ). KHÔNG trả password_hash/secret_ref/
 * normalized_email. Service này CHỈ đọc — KHÔNG có path ghi/sửa/xoá (append-only).
 */
@Injectable()
export class AuthLogsViewerService {
  constructor(
    private readonly db: DatabaseService,
    private readonly loginLogs: LoginLogRepository,
    private readonly securityEvents: SecurityEventRepository,
  ) {}

  /** AUTH-API-401 — list login-log của tenant hiện tại (RLS ép qua withTenant). */
  async listLoginLogs(
    companyId: string,
    query: LoginLogListQuery,
  ): Promise<AuthLogPage<LoginLogListItem>> {
    const offset = (query.page - 1) * query.per_page;
    const filter: LoginLogFilter = {
      userId: query.user_id,
      status: query.status,
      dateFrom: query.from_date,
      dateTo: query.to_date,
    };
    return this.db.withTenant(companyId, async (tx) => {
      const [rows, total] = await Promise.all([
        this.loginLogs.findManyTx(tx, filter, query.sort, query.order, query.per_page, offset),
        this.loginLogs.countTx(tx, filter),
      ]);
      return { data: rows.map((row) => this.toLoginLogItem(row)), total };
    });
  }

  /** AUTH-API-402 — list security-event của tenant hiện tại (RLS ép qua withTenant). */
  async listSecurityEvents(
    companyId: string,
    query: SecurityEventListQuery,
  ): Promise<AuthLogPage<SecurityEventListItem>> {
    const offset = (query.page - 1) * query.per_page;
    const filter: SecurityEventFilter = {
      userId: query.user_id,
      eventType: query.event_type,
      severity: query.severity,
      dateFrom: query.from_date,
      dateTo: query.to_date,
    };
    return this.db.withTenant(companyId, async (tx) => {
      const [rows, total] = await Promise.all([
        this.securityEvents.findManyTx(tx, filter, query.sort, query.order, query.per_page, offset),
        this.securityEvents.countTx(tx, filter),
      ]);
      return { data: rows.map((row) => this.toSecurityEventItem(row)), total };
    });
  }

  /** Ref user rút gọn — chỉ khi có CẢ id lẫn email (user soft-delete/UserNotFound ⇒ null). */
  private userRef(
    id: string | null,
    email: string | null,
    fullName: string | null,
  ): AuthLogUserRef | null {
    if (!id || !email) return null;
    return { id, email, display_name: fullName };
  }

  private toLoginLogItem(row: LoginLogRow): LoginLogListItem {
    return {
      id: row.id,
      user: this.userRef(row.userId, row.userEmail, row.userFullName),
      status: row.loginStatus as LoginLogStatus,
      ip_address: row.ipAddress,
      user_agent: row.userAgent,
      failure_reason: row.failureReason,
      created_at: row.createdAt.toISOString(),
    };
  }

  private toSecurityEventItem(row: SecurityEventRow): SecurityEventListItem {
    return {
      id: row.id,
      user: this.userRef(row.userId, row.userEmail, row.userFullName),
      event_type: row.eventType,
      severity: row.severity as SecurityEventSeverity,
      actor: this.userRef(row.actorUserId, row.actorEmail, row.actorFullName),
      ip_address: row.ipAddress,
      user_agent: row.userAgent,
      created_at: row.createdAt.toISOString(),
    };
  }
}
