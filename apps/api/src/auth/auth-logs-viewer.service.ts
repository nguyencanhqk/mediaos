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
import type { PgColumn } from "drizzle-orm/pg-core";
import { DataScopeService } from "../permission/data-scope.service";
import { fromScope, type IdentityGrant } from "../permission/identity-projection";
import { users } from "../db/schema/users";
import { LoginLogRepository, type LoginLogFilter, type LoginLogRow } from "./login-log.repository";
import {
  SecurityEventRepository,
  SECURITY_EVENT_ACTOR,
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
    // S6-SEC-IDENTITY-PROJ-1 (KI-054) — BẮT BUỘC. Docstring của lớp này từng ghi "Company-scope" như
    // một sự thật; nó là ý định. Không có gì trong đường đọc resolve `data_scope`, nên một vai giữ
    // `view:audit-log@Own` vẫn nhận email + họ tên của MỌI người trong 364 dòng login_logs.
    private readonly dataScope: DataScopeService,
  ) {}

  /**
   * Vị từ scope cho cặp danh bạ `view:user`, dựng trên CỘT ĐÍCH được chỉ định.
   *
   * `resolveOrNull` chứ không `resolveAndAssert`: cặp GATE của hai route này là `view:audit-log`, còn
   * cặp BOUND cột danh tính là `view:user` — HAI cặp khác nhau (khuôn N-1c). Một vai hoàn toàn có thể
   * đọc được nhật ký mà không được xem danh bạ; biến việc đó thành 403 cả route là siết quá tay và
   * làm mất một quyền đang có. Fail-closed ĐÚNG mức là bỏ cột danh tính.
   */
  private async identityGrantFor(
    actor: { id: string; companyId: string },
    target: { idCol: PgColumn; companyIdCol: PgColumn },
    why: string,
  ): Promise<IdentityGrant> {
    const scope = await this.dataScope.resolveOrNull(actor.id, actor.companyId, "view", "user");
    return fromScope(
      scope === null
        ? null
        : this.dataScope.buildUserScopeConditionOn(
            scope,
            { userId: actor.id, companyId: actor.companyId },
            target,
          ),
      "identity-gated",
      why,
    );
  }

  /** AUTH-API-401 — list login-log của tenant hiện tại (RLS ép qua withTenant). */
  async listLoginLogs(
    actor: { id: string; companyId: string },
    query: LoginLogListQuery,
  ): Promise<AuthLogPage<LoginLogListItem>> {
    const companyId = actor.companyId;
    const identity = await this.identityGrantFor(
      actor,
      { idCol: users.id, companyIdCol: users.companyId },
      "GET /auth/login-logs — cột danh tính đi theo data_scope của cặp danh bạ view:user (KI-054)",
    );
    const offset = (query.page - 1) * query.per_page;
    const filter: LoginLogFilter = {
      userId: query.user_id,
      status: query.status,
      dateFrom: query.from_date,
      dateTo: query.to_date,
    };
    return this.db.withTenant(companyId, async (tx) => {
      const [rows, total] = await Promise.all([
        this.loginLogs.findManyTx(
          tx,
          filter,
          query.sort,
          query.order,
          query.per_page,
          offset,
          identity,
        ),
        this.loginLogs.countTx(tx, filter),
      ]);
      return { data: rows.map((row) => this.toLoginLogItem(row)), total };
    });
  }

  /** AUTH-API-402 — list security-event của tenant hiện tại (RLS ép qua withTenant). */
  async listSecurityEvents(
    actor: { id: string; companyId: string },
    query: SecurityEventListQuery,
  ): Promise<AuthLogPage<SecurityEventListItem>> {
    const companyId = actor.companyId;
    // HAI grant cho HAI vai. Xem chú thích trong `security-event.repository.findManyTx` — tái dùng
    // một grant cho cả hai vừa đẻ lỗ mới vừa hồi quy đường ALLOW.
    const [identitySubject, identityActor] = await Promise.all([
      this.identityGrantFor(
        actor,
        { idCol: users.id, companyIdCol: users.companyId },
        "GET /auth/security-events — cột danh tính CHỦ THỂ theo data_scope của view:user (KI-054)",
      ),
      this.identityGrantFor(
        actor,
        { idCol: SECURITY_EVENT_ACTOR.id, companyIdCol: SECURITY_EVENT_ACTOR.companyId },
        "GET /auth/security-events — cột danh tính NGƯỜI GÂY RA theo data_scope của view:user (KI-054)",
      ),
    ]);
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
        this.securityEvents.findManyTx(
          tx,
          filter,
          query.sort,
          query.order,
          query.per_page,
          offset,
          identitySubject,
          identityActor,
        ),
        this.securityEvents.countTx(tx, filter),
      ]);
      return { data: rows.map((row) => this.toSecurityEventItem(row)), total };
    });
  }

  /**
   * Ref user rút gọn — BA nhánh, và ba nhánh phải phân biệt được với nhau.
   *
   * ⚠️ Đây là chỗ dễ đẻ bẫy KI-052 nhất trong cả bản vá (plan-review vòng 1, B2). `AuthLogUserRef` là
   * object LỒNG, không phải khoá phẳng — nên không có khoá nào để "bỏ hẳn". Bản gốc trả `null` khi
   * thiếu email; nếu cứ thế che email thì cả object thành `null`, mà `null` **đã mang sẵn một nghĩa
   * khác**: "log không gắn user" hoặc "user đã bị xoá". Sau bản vá `null` sẽ mang hai nghĩa và không
   * ai phân biệt được nữa — đúng thứ WO này tồn tại để chống.
   *
   *   • `!id`                      → `null`  : log không gắn user (đăng nhập fail trước khi resolve).
   *   • `id` + NGOÀI scope         → `{ id, display_name: null }`, KHÔNG có khoá `email`.
   *   • `id` + trong scope + !email→ `null`  : join trượt (user đã bị xoá cứng). NGHĨA CŨ, giữ nguyên.
   *   • còn lại                    → đủ ba trường.
   *
   * `display_name: null` ở nhánh ngoài-scope KHÔNG lẫn nghĩa: hợp đồng đã cho phép `null` (user chưa
   * đặt họ tên), và khoá `email` VẮNG MẶT mới là tín hiệu phân biệt — nên tín hiệu nằm ở chỗ không
   * lẫn với dữ liệu.
   */
  private userRef(
    id: string | null,
    email: string | null,
    fullName: string | null,
    identityInScope: boolean,
  ): AuthLogUserRef | null {
    if (!id) return null;
    if (!identityInScope) return { id, display_name: null };
    if (!email) return null;
    return { id, email, display_name: fullName };
  }

  private toLoginLogItem(row: LoginLogRow): LoginLogListItem {
    return {
      id: row.id,
      user: this.userRef(row.userId, row.userEmail, row.userFullName, row.identityInScope),
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
      user: this.userRef(row.userId, row.userEmail, row.userFullName, row.identityInScope),
      event_type: row.eventType,
      severity: row.severity as SecurityEventSeverity,
      // Cờ RIÊNG cho vai actor — `identityColumns` gọi hai lần nên trả hai cờ; drizzle đặt cờ sau đè
      // cờ trước nếu trùng tên, vì thế repo đổi tên cờ thứ hai thành `actorIdentityInScope`.
      actor: this.userRef(
        row.actorUserId,
        row.actorEmail,
        row.actorFullName,
        row.actorIdentityInScope,
      ),
      ip_address: row.ipAddress,
      user_agent: row.userAgent,
      created_at: row.createdAt.toISOString(),
    };
  }
}
