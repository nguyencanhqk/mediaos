import { ForbiddenException, Injectable, Logger } from "@nestjs/common";
import type {
  AuthLogUserRef,
  DataScope,
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
import { loginLogs, userSecurityEvents } from "../db/schema/auth-logs";
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
 * AuthLogsViewerService (S2-AUTH-BE-5) — đọc CHỈ-ĐỌC `login_logs` + `user_security_events`. Map
 * row→DTO CHỈ phơi field forensic an toàn (status/severity/ip/user_agent/reason + ref user/actor
 * rút gọn).
 *
 * ── HAI TẦNG CHẶN, HAI CẶP QUYỀN KHÁC NHAU — đọc kỹ trước khi sửa ────────────────────────────────
 *
 *   TẬP HÀNG ← `data_scope` của cặp **`view:audit-log`** (chính cặp GATE của route).
 *              `Company`/`System` = cả tenant · `Own` = hàng có `user_id = actor`
 *              · `Team`/`Department` = 0 hàng (fail-closed, lattice chưa định nghĩa membership).
 *   CỘT DANH TÍNH ← `data_scope` của cặp **`view:user`** (cặp danh bạ, KHÁC cặp gate — khuôn N-1c).
 *
 * ⚠️ Docstring của lớp này TỪNG ghi "Company-scope" như một sự thật, trong khi **không có gì** trong
 * đường đọc resolve `data_scope` (KI-054 → vế cột, KI-070 → vế hàng). Đó là ý định được viết thành
 * mô tả. Nếu bạn sắp thêm một câu mô tả phạm vi vào đây, hãy kèm theo dòng code ép nó.
 *
 * ⚠️ Ranh giới CỐ Ý (S10-SEC-AUDITLOGROW-1):
 *   • `Own` trên security-event bám **CHỦ THỂ** (`user_id`), KHÔNG `OR actor_user_id` — xem
 *     `security-event.repository.buildWhere`.
 *   • `?user_id=` của caller được đối chiếu bằng phép **GIAO** với vị từ scope (0 hàng + HTTP 200),
 *     KHÔNG bằng 403 — 403 ở đó phân biệt "ngoài scope" với "không có hàng" = oracle tồn tại.
 *   • Lưới scope KHÔNG đơn điệu: giữ đồng thời `@Own` + `@Team` ⇒ resolve ra `Team` ⇒ MẤT hàng. Sai
 *     về phía hẹp; sàn hoá phải làm cho cả ba đường dùng chung lattice, không lén vá ở đây.
 *
 * BẤT BIẾN #3 (không secret plaintext): cột jsonb `metadata` (login_logs) / `payload` (user_security_events)
 * có thể chứa token/secret theo ngữ cảnh → repo KHÔNG select, service KHÔNG map. Đây là cách che MẠNH HƠN
 * redact-at-read (field không tồn tại trong DTO ⇒ không có đường lộ). KHÔNG trả password_hash/secret_ref/
 * normalized_email. Service này CHỈ đọc — KHÔNG có path ghi/sửa/xoá (append-only).
 */
@Injectable()
export class AuthLogsViewerService {
  private readonly logger = new Logger(AuthLogsViewerService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly loginLogs: LoginLogRepository,
    private readonly securityEvents: SecurityEventRepository,
    // BẮT BUỘC — nguồn của CẢ HAI tầng chặn. Docstring của lớp này từng ghi "Company-scope" như một
    // sự thật; nó là ý định. KI-054: không gì resolve `data_scope` ⇒ vai `view:audit-log@Own` nhận
    // email + họ tên của MỌI người. KI-070: cũng không gì chặn TẬP HÀNG ⇒ vai đó đọc trọn 366 hàng.
    private readonly dataScope: DataScopeService,
  ) {}

  /**
   * S10-SEC-AUDITLOGROW-1 (KI-070) — vị từ chặn **TẬP HÀNG** của một bảng nhật ký, theo `data_scope`
   * của cặp **`view:audit-log`**.
   *
   * ⚠️ Ở đây cặp GATE **chính là** cặp BOUND, nên luật ngược hẳn với `identityGrantFrom` bên dưới:
   * `null` sau khi guard đã cho qua KHÔNG phải "actor không có cặp danh bạ" — nó nghĩa là **guard và
   * trình phân giải scope BẤT ĐỒNG**, một trạng thái không được im lặng ⇒ 403 fail-closed.
   *
   * VÌ SAO KHÔNG gọi `DataScopeService.resolveAndAssert` (nó ném đúng 403 này): hàm đó **không log
   * một dòng nào**, nên 403 của nó không phân biệt được với 403 của guard ở mọi tầng vận hành — đúng
   * chế độ mù mà `resolveDirectoryScope` đã phải thêm `logger.warn` để tránh. Và KHÔNG thêm log vào
   * trong `resolveAndAssert`: hàm đó có ~101 call-site, phần lớn dùng nó làm cổng DUY NHẤT, ở đó
   * `null` là deny BÌNH THƯỜNG ⇒ log `error` sẽ thành báo động giả hàng loạt.
   *
   * ⚠️ Chuỗi message giữ **NGUYÊN VĂN** của `resolveAndAssert` — và đây là điều nó thật sự bảo đảm,
   * không hơn (plan-review vòng 2): `AllExceptionsFilter` không phân biệt exception ném từ guard với
   * ném từ service, nên `status` (403) + `code` + `type` (`ForbiddenException`) + `details` GIỐNG HỆT
   * 403 của guard. Chỉ `message` khác (guard trả `Permission denied: <reason>`). Khác biệt đó ĐÃ tồn
   * tại sẵn ở toàn bộ ~101 call-site `resolveAndAssert` và chỉ nói cho actor về grant CỦA CHÍNH HỌ —
   * nó không tiết lộ gì về hàng hay về người khác. Cái KHÔNG được phép là làm message giàu thông tin
   * hơn ("scope resolution failed", tên cặp quyền, tên bảng): đó mới là oracle.
   *
   * `{ isSensitive: true }` soi gương `@RequirePermission("view","audit-log",{ isSensitive: true })`.
   * Bỏ nó thì kết quả vẫn đúng HÔM NAY (catalog có `is_sensitive=true` nên `effectivelySensitive` tự
   * bật) — tức đúng nhờ DỮ LIỆU, không nhờ code: lật cờ catalog là route mở cho wildcard `*:*`.
   */
  private async rowScopeFor(
    actor: { id: string; companyId: string },
    target: { idCol: PgColumn; companyIdCol: PgColumn },
    why: string,
  ): Promise<IdentityGrant> {
    const scope = await this.dataScope.resolveOrNull(
      actor.id,
      actor.companyId,
      "view",
      "audit-log",
      { isSensitive: true },
    );
    if (scope === null) {
      // ⚠️ HAI nguyên nhân cho cùng một `null`, và log KHÔNG được chẩn đoán hộ chỉ một trong hai:
      //   • grant vừa bị gỡ — guard còn phục vụ từ cache 300s (`permission.cache.ts`) trong khi
      //     `getCompanyRoleGrantsWithScope` đọc thẳng DB ⇒ hai tầng bất đồng trong cửa sổ đó;
      //   • lỗi HẠ TẦNG — `resolveStrongestScope` bắt mọi exception và fail-closed về `null`, kèm
      //     một dòng `resolveStrongestScope() infrastructure error` của riêng nó.
      // Đối chiếu hai dòng log trên cùng một request mới ra được nguyên nhân; viết sẵn một chẩn đoán
      // vào đây là dẫn người trực ca đi sai đường đúng lúc họ tin nó nhất.
      this.logger.error(
        "auth-logs: guard cho qua nhưng resolveStrongestScope trả null — grant vừa bị gỡ (cửa sổ " +
          "cache guard) HOẶC lỗi hạ tầng; đối chiếu log `resolveStrongestScope() infrastructure " +
          "error` cùng request trước khi kết luận",
        { userId: actor.id, companyId: actor.companyId, where: why },
      );
      throw new ForbiddenException("AUTH-ERR-FORBIDDEN: out of permission scope");
    }
    return fromScope(
      this.dataScope.buildUserScopeConditionOn(
        scope,
        { userId: actor.id, companyId: actor.companyId },
        target,
      ),
      "scoped-predicate",
      why,
      // Buộc vị từ vào ĐÚNG bảng: `rowScopeSql` ném nếu ai đem grant này AND vào truy vấn bảng kia.
      target.idCol,
    );
  }

  /**
   * `data_scope` của cặp danh bạ `view:user` — phân giải ĐÚNG MỘT LẦN cho mỗi request.
   *
   * `resolveOrNull` chứ không `resolveAndAssert`: cặp GATE của hai route này là `view:audit-log`, còn
   * cặp BOUND cột danh tính là `view:user` — HAI cặp khác nhau (khuôn N-1c). Một vai hoàn toàn có thể
   * đọc được nhật ký mà không được xem danh bạ; biến việc đó thành 403 cả route là siết quá tay và
   * làm mất một quyền đang có. Fail-closed ĐÚNG mức là bỏ cột danh tính.
   *
   * ⟲ S10-SEC-AUDITLOGROW-1 — TÁCH khỏi `identityGrantFor` cũ (phân giải + dựng grant trong một hàm).
   * Bản cũ hỏi lại cặp này cho MỖI vai, tức `/auth/security-events` bắn **hai** truy vấn y hệt nhau
   * (chủ thể + người gây ra), mà `getCompanyRoleGrantsWithScope` **không được cache**
   * (`permission.cache.ts` — passthrough cố ý). Thêm cặp `view:audit-log` nữa là ba lượt/request.
   * Nay: một lượt cho mỗi CẶP, rồi dựng nhiều grant từ cùng một giá trị scope. Hai grant vẫn ĐỘC LẬP
   * và vẫn dựng trên cột của vai mình — lỗ B1 của KI-054 vẫn đóng; cái đổi là số lượt hỏi DB, không
   * phải vị từ.
   */
  private async resolveDirectoryScope(
    actor: { id: string; companyId: string },
    why: string,
  ): Promise<DataScope | null> {
    const scope = await this.dataScope.resolveOrNull(actor.id, actor.companyId, "view", "user");
    if (scope === null) {
      // Nhánh fail-closed PHẢI để lại vết. Không có dòng này thì vận hành không phân biệt được
      // "actor thật sự ngoài scope danh bạ" với "trình phân giải scope đang gãy" — cả hai đều ra một
      // bảng nhật ký mất sạch email/tên.
      this.logger.warn(
        "auth-logs: không phân giải được data_scope cặp danh bạ → BỎ cột danh tính",
        {
          userId: actor.id,
          companyId: actor.companyId,
          where: why,
        },
      );
    }
    return scope;
  }

  /**
   * Dựng grant che CỘT danh tính cho MỘT vai, từ scope danh bạ đã phân giải ở trên.
   *
   * ⚠️ MỘT VAI = MỘT GRANT, dựng trên CỘT CỦA VAI ĐÓ. Truy vấn security-event join `users` hai lần
   * (chủ thể / người gây ra); dùng chung một vị từ cho cả hai vừa lộ email của vai kia vừa giấu email
   * của chính mình — hai chiều đều sai (KI-054 lỗ B1).
   */
  private identityGrantFrom(
    scope: DataScope | null,
    actor: { id: string; companyId: string },
    target: { idCol: PgColumn; companyIdCol: PgColumn },
    why: string,
  ): IdentityGrant {
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
      // Buộc grant vào ĐÚNG vai: `identityColumns` sẽ ném nếu ai đó đem grant này bọc cột vai kia.
      target.idCol,
    );
  }

  /**
   * AUTH-API-401 — list login-log. HÀNG theo `view:audit-log`, CỘT danh tính theo `view:user`
   * (hai cặp quyền khác nhau — xem docblock lớp).
   */
  async listLoginLogs(
    actor: { id: string; companyId: string },
    query: LoginLogListQuery,
  ): Promise<AuthLogPage<LoginLogListItem>> {
    const companyId = actor.companyId;
    // `rowScopeFor` CÓ THỂ NÉM 403 — cố ý để nó ném trước khi chạm DB, và cố ý KHÔNG bọc trong
    // `Promise.all` cùng nhánh danh bạ: một rejection ở đó sẽ làm lời hứa kia thành unhandled.
    const rowScope = await this.rowScopeFor(
      actor,
      { idCol: loginLogs.userId, companyIdCol: loginLogs.companyId },
      "GET /auth/login-logs — TẬP HÀNG đi theo data_scope của cặp gate view:audit-log (KI-070)",
    );
    const dirScope = await this.resolveDirectoryScope(
      actor,
      "GET /auth/login-logs — cột danh tính đi theo data_scope của cặp danh bạ view:user (KI-054)",
    );
    const identity = this.identityGrantFrom(
      dirScope,
      actor,
      { idCol: users.id, companyIdCol: users.companyId },
      "GET /auth/login-logs — cột danh tính đi theo data_scope của cặp danh bạ view:user (KI-054)",
    );
    const offset = (query.page - 1) * query.per_page;
    const filter: LoginLogFilter = {
      userId: query.user_id,
      status: query.status,
      // S10-SEC-LOGINLOG429-1 (KI-048): không có vị từ này thì hàng `blocked` — thứ có tốc độ sinh
      // do kẻ tấn công điều khiển — chôn mọi tín hiệu khác của AUTH-API-401 dưới nhiễu.
      failureReason: query.failure_reason,
      dateFrom: query.from_date,
      dateTo: query.to_date,
    };
    const page = {
      sort: query.sort,
      order: query.order,
      limit: query.per_page,
      offset,
    };
    return this.db.withTenant(companyId, async (tx) => {
      const [rows, total] = await Promise.all([
        this.loginLogs.findManyTx(tx, filter, page, { rowScope, identity }),
        // ⚠️ `rowScope` BẮT BUỘC ở đây nữa: đếm không có vị từ scope thì `pagination.total` rò số
        // hàng ngoài scope trong khi `data` sạch — oracle đếm được, không lộ ra ở body.
        this.loginLogs.countTx(tx, filter, { rowScope }),
      ]);
      return { data: rows.map((row) => this.toLoginLogItem(row)), total };
    });
  }

  /**
   * AUTH-API-402 — list security-event. HÀNG theo `view:audit-log` (bám CHỦ THỂ, không bám người gây
   * ra — xem `security-event.repository.buildWhere`), CỘT danh tính theo `view:user` cho TỪNG vai.
   */
  async listSecurityEvents(
    actor: { id: string; companyId: string },
    query: SecurityEventListQuery,
  ): Promise<AuthLogPage<SecurityEventListItem>> {
    const companyId = actor.companyId;
    const rowScope = await this.rowScopeFor(
      actor,
      { idCol: userSecurityEvents.userId, companyIdCol: userSecurityEvents.companyId },
      "GET /auth/security-events — TẬP HÀNG đi theo data_scope của cặp gate view:audit-log (KI-070)",
    );
    // MỘT lượt phân giải cặp danh bạ → HAI grant cho HAI vai. Xem chú thích trong
    // `security-event.repository.findManyTx`: tái dùng một GRANT cho cả hai vai vừa đẻ lỗ mới vừa hồi
    // quy đường ALLOW. Tái dùng một giá trị SCOPE để dựng hai grant thì không — mỗi grant vẫn có vị
    // từ riêng dựng trên cột của vai mình.
    const dirScope = await this.resolveDirectoryScope(
      actor,
      "GET /auth/security-events — cột danh tính theo data_scope của cặp danh bạ view:user (KI-054)",
    );
    const identitySubject = this.identityGrantFrom(
      dirScope,
      actor,
      { idCol: users.id, companyIdCol: users.companyId },
      "GET /auth/security-events — cột danh tính CHỦ THỂ theo data_scope của view:user (KI-054)",
    );
    const identityActor = this.identityGrantFrom(
      dirScope,
      actor,
      { idCol: SECURITY_EVENT_ACTOR.id, companyIdCol: SECURITY_EVENT_ACTOR.companyId },
      "GET /auth/security-events — cột danh tính NGƯỜI GÂY RA theo data_scope của view:user (KI-054)",
    );
    const offset = (query.page - 1) * query.per_page;
    const filter: SecurityEventFilter = {
      userId: query.user_id,
      eventType: query.event_type,
      severity: query.severity,
      dateFrom: query.from_date,
      dateTo: query.to_date,
    };
    const page = {
      sort: query.sort,
      order: query.order,
      limit: query.per_page,
      offset,
    };
    return this.db.withTenant(companyId, async (tx) => {
      const [rows, total] = await Promise.all([
        this.securityEvents.findManyTx(tx, filter, page, {
          rowScope,
          identitySubject,
          identityActor,
        }),
        this.securityEvents.countTx(tx, filter, { rowScope }),
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
   *   • `!id`               → `null`                        : log không gắn user (đăng nhập fail
   *                                                            trước khi resolve được ai).
   *   • `id` + ngoài scope  → `{ id, display_name: null }`  : KHÔNG có khoá `email`.
   *   • còn lại             → đủ ba trường.
   *
   * ⚠️ **ĐÍNH CHÍNH (security-reviewer 2026-08-19, F2) — hai ca CHIA CHUNG hình dạng, và đó là điều
   * đã cân nhắc chứ không phải sót.** Bản đầu của hàm này có nhánh thứ tư "trong scope nhưng thiếu
   * email ⇒ user đã bị xoá cứng ⇒ `null`". Nhánh đó **KHÔNG THỂ CHẠM TỚI**: `users.email` là NOT
   * NULL, nên join trúng thì luôn có email; còn join TRƯỢT thì mọi cột NULL ⇒ vị từ cho `NULL` ⇒ cờ
   * (sau `coalesce`) là `false` ⇒ hàng rơi vào nhánh "ngoài scope". Tức "user đã xoá cứng" và "ngoài
   * scope danh bạ" cho ra CÙNG `{ id, display_name: null }`.
   *
   * Chấp nhận được, và nói ra lý do thay vì để nó thành khoảng trống: cả hai đều nghĩa là "không có
   * danh tính để hiện", và `id` VẪN CÒN nên hàng vẫn truy được — nhiều thông tin hơn bản gốc (bản gốc
   * trả `null` cho cả object ở ca user-đã-xoá). Cái KHÔNG được phép là dùng `null` để mang thêm một
   * nghĩa thứ hai (bẫy KI-052); ở đây `null` giữ đúng một nghĩa: "không có user để hiện".
   */
  private userRef(
    id: string | null,
    email: string | null,
    fullName: string | null,
    identityInScope: boolean,
  ): AuthLogUserRef | null {
    if (!id) return null;
    if (!identityInScope) return { id, display_name: null };
    // KHÔNG có nhánh `if (!email) return null` — nó chết (xem docblock). Thêm lại là code không bao
    // giờ chạy, tức một lời hứa mà test không kiểm được.
    // BỎ HẲN KHOÁ, không đặt `email: undefined` — khoá tồn tại với giá trị undefined vẫn lọt vào
    // `"email" in obj`, tức mọi assert "đã bỏ khoá" của int-spec sẽ xanh-giả.
    return email === null ? { id, display_name: fullName } : { id, email, display_name: fullName };
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
