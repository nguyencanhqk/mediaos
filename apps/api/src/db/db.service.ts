import { Injectable, Logger } from "@nestjs/common";
import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db, directPool, pool } from "./index";

export interface DbPingResult {
  ok: boolean;
  latencyMs: number | null;
  error?: string;
}

/** Transaction-scoped Drizzle client trao cho callback của `withTenant`. */
export type TenantTx = Parameters<Parameters<NonNullable<typeof db>["transaction"]>[0]>[0];

/** companyId PHẢI là UUID — chặn injection/giá trị rác TRƯỚC khi mở transaction. */
const companyIdSchema = z.string().uuid();

/**
 * Lỗi khi thiếu cấu hình DB (DATABASE_URL) — fail-fast, không nuốt lỗi (silent-failure-hunter).
 */
export class DatabaseNotConfiguredError extends Error {
  constructor() {
    super("DATABASE_URL chưa cấu hình — không thể mở withTenant.");
    this.name = "DatabaseNotConfiguredError";
  }
}

/** Lỗi companyId không hợp lệ (không phải UUID) — chặn trước khi chạm DB. */
export class InvalidCompanyIdError extends Error {
  constructor() {
    super("companyId không hợp lệ (phải là UUID).");
    this.name = "InvalidCompanyIdError";
  }
}

/**
 * Cổng truy cập hạ tầng DB cho Nest DI.
 *
 * `withTenant` là CHỐT DUY NHẤT cho mọi data-access nghiệp vụ (ADR-0001, BẤT BIẾN #1):
 * mở 1 transaction → set `app.current_company_id` LOCAL (transaction-scoped, an toàn PgBouncer
 * transaction-mode — ADR-0003) → chạy callback → commit. RLS policy (G2-3) đọc GUC này để lọc.
 *
 * CẤM query nghiệp vụ thẳng trên `db`/`pool` ngoài `withTenant` (sẽ bị RLS chặn = 0 row, hoặc rò nếu
 * quên WHERE). Hook `guard-tenant.mjs` canh điều này.
 */
@Injectable()
export class DatabaseService {
  private readonly logger = new Logger(DatabaseService.name);

  async ping(): Promise<DbPingResult> {
    const target = pool ?? directPool;
    if (!target) {
      return { ok: false, latencyMs: null, error: "DATABASE_URL not configured" };
    }

    const start = Date.now();
    try {
      await target.query("SELECT 1");
      return { ok: true, latencyMs: Date.now() - start };
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown error";
      this.logger.warn(`DB ping failed: ${message}`);
      return { ok: false, latencyMs: null, error: message };
    }
  }

  /**
   * Chạy `fn` trong ngữ cảnh tenant `companyId`. Mọi query trong `fn` chỉ thấy dữ liệu của tenant đó
   * (RLS ép ở DB). Lỗi trong `fn` → rollback toàn bộ transaction (audit không ghi nửa vời).
   *
   * @throws InvalidCompanyIdError nếu companyId không phải UUID (KHÔNG mở transaction).
   * @throws DatabaseNotConfiguredError nếu DATABASE_URL chưa cấu hình.
   */
  async withTenant<T>(companyId: string, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
    const parsed = companyIdSchema.safeParse(companyId);
    if (!parsed.success) {
      throw new InvalidCompanyIdError();
    }
    if (!db) {
      throw new DatabaseNotConfiguredError();
    }

    return db.transaction(async (tx) => {
      // set_config(..., true) = LOCAL: chỉ sống trong transaction này, tự reset khi commit/rollback
      // → connection trả về PgBouncer KHÔNG mang GUC sang tenant kế tiếp (chống rò chéo tenant).
      // ${parsed.data} = bind-param ($1), TUYỆT ĐỐI không string-concat (chống SQL injection).
      await tx.execute(
        sql`select set_config('app.current_company_id', ${parsed.data}, true)`,
      );
      return fn(tx);
    });
  }

  /**
   * G16-3 (ADR-0017): ngữ cảnh PLATFORM-admin — set GUC `app.platform_admin='on'` (LOCAL) để vượt RLS
   * `companies` CHÉO tenant. CHỈ dùng cho ĐÚNG 1 thao tác KHÔNG có tenant context: LIST mọi công ty.
   * (CREATE công ty mới KHÔNG dùng helper này — sinh UUID sẵn rồi `withTenant(newId)` insert + provision
   * ATOMIC.) KHÔNG set company GUC ⇒ MỌI bảng nghiệp vụ khác (RLS keyed company_id) vẫn 0 row trong ngữ
   * cảnh này (fail-closed) — escape-hatch CHỈ nới policy `companies` (mig 0230). Default-deny: GUC chưa set
   * ở mọi đường khác ⇒ company-admin thường KHÔNG bao giờ thấy chéo tenant.
   *
   * BẢO MẬT: chỉ gọi từ service ĐÃ qua PermissionGuard với quyền `view:platform-company` (is_sensitive).
   */
  /**
   * Chạy 1 câu SQL KHÔNG-tenant-context — CHỈ cho 2 trường hợp hẹp:
   *   (1) gọi function SECURITY DEFINER đã tự kiểm soát phạm vi (AC-5 resolve_api_key_by_prefix — auth-path
   *       không biết company trước, function trả ĐÚNG cột cần verify hash).
   *   (2) đọc catalog GLOBAL no-RLS (permissions) — không có company_id nên withTenant vô nghĩa.
   * KHÔNG dùng cho bảng nghiệp vụ tenant-scoped (FORCE-RLS sẽ trả 0 row nếu không có context → fail-closed,
   * không rò). `db` ở đây là pool qua PgBouncer; câu lệnh tự-đủ trong 1 round-trip (không giữ GUC).
   */
  async runRaw<R>(query: SQL): Promise<R[]> {
    if (!db) {
      throw new DatabaseNotConfiguredError();
    }
    const result = await db.execute(query);
    return result.rows as R[];
  }

  /**
   * AC-9: transaction KHÔNG-tenant-context cho bảng GLOBAL no-RLS OPERATOR-SCOPED (db_ops_grants/
   * db_ops_grant_approvals/db_export_jobs — KHÔNG company_id, KHÔNG RLS). App role có grant trực tiếp
   * (SELECT/INSERT + column-UPDATE) trên các bảng này; KHÔNG set GUC nào ⇒ MỌI bảng nghiệp vụ tenant-scoped
   * (FORCE-RLS keyed app.current_company_id) vẫn 0 row trong tx này (fail-closed — KHÔNG rò chéo tenant).
   *
   * Dùng cho FSM break-glass db-ops (FOR UPDATE serialize approve/revoke). KHÔNG dùng cho bảng tenant-scoped
   * (sẽ trả 0 row vì thiếu company GUC). KHÔNG phải escape-hatch: không nới policy, chỉ chạy trên bảng đã
   * no-RLS-by-design (target_tenant_id, không company_id).
   */
  async withTransaction<T>(fn: (tx: TenantTx) => Promise<T>): Promise<T> {
    if (!db) {
      throw new DatabaseNotConfiguredError();
    }
    return db.transaction(async (tx) => fn(tx));
  }

  async withPlatformContext<T>(fn: (tx: TenantTx) => Promise<T>): Promise<T> {
    if (!db) {
      throw new DatabaseNotConfiguredError();
    }
    return db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.platform_admin', 'on', true)`);
      return fn(tx);
    });
  }

  /**
   * AC-8 (cross-tenant primitive #2): ngữ cảnh PLATFORM-AUDIT-READ — set GUC `app.platform_audit_read='on'`
   * (LOCAL) để ĐỌC CHÉO tenant trên ĐÚNG 3 bảng quan sát (audit_logs / outbox_events / dead_letter_events).
   *
   * KHÁC `withPlatformContext` (app.platform_admin chỉ nới `companies`, mig 0230): GUC HẸP RIÊNG này CHỈ bật
   * policy `*_platform_audit_read` (FOR SELECT, USING-only — mig 0340) ⇒ blast-radius = 3 bảng quan sát,
   * read-only by construction (KHÔNG WITH CHECK ⇒ KHÔNG thể INSERT/UPDATE chéo tenant qua đây).
   *
   * HỢP ĐỒNG SELECT-ONLY (ép bằng usage + bằng việc policy KHÔNG có nhánh cross-tenant trên WITH CHECK):
   *   chỉ chạy SELECT chéo tenant trong `fn`; KHÔNG ghi nghiệp vụ chéo tenant ở đây. Mọi GHI audit
   *   (recordOperatorAction cho mỗi lần đọc) PHẢI đi `withTenant(targetTenantId)` RIÊNG (company_id = target
   *   qua GUC), KHÔNG ghi trong ngữ cảnh này (audit_logs WITH CHECK vẫn keyed app.current_company_id ⇒
   *   INSERT ở đây sẽ FAIL-CLOSED vì current_company_id chưa set). Default-DENY ngoài helper: GUC chưa set
   *   ⇒ 0 row chéo tenant ở mọi đường khác. TÁI DÙNG bởi AC-9 (data-ops read-only).
   */
  async withPlatformReadContext<T>(fn: (tx: TenantTx) => Promise<T>): Promise<T> {
    if (!db) {
      throw new DatabaseNotConfiguredError();
    }
    return db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.platform_audit_read', 'on', true)`);
      return fn(tx);
    });
  }

  /**
   * WAVE 3 C1 (ADR-0021 — Tầng 3 của ADR-0019): ngữ cảnh ALL-TENANT READ-ONLY — `SET LOCAL ROLE
   * mediaos_readonly` (LOCAL = transaction-scoped, tự reset khi commit/rollback ⇒ an toàn PgBouncer
   * transaction-mode ADR-0003, KHÔNG mang role sang request kế tiếp). Dưới role này, policy
   * `<bảng>_all_tenant_read` (FOR SELECT USING(true), mig 0346) cho ĐỌC mọi tenant trên bảng allowlist;
   * column-GRANT hẹp ⇒ secret/PII ungettable Ở DB. mediaos_readonly là NOBYPASSRLS (KHÔNG bypass — vẫn
   * lọt assertWorkerRoleSafe), NOLOGIN.
   *
   * KHÁC withPlatformReadContext (GUC app.platform_audit_read, app role): đây ĐỔI ROLE thật. KHÁC
   * withPlatformContext (chỉ nới companies). CỐ Ý KHÔNG set app.current_company_id (quét all-tenant).
   *
   * HỢP ĐỒNG SELECT-ONLY (ép Ở DB): role KHÔNG có INSERT/UPDATE/DELETE + policy KHÔNG có WITH CHECK ⇒
   * mọi GHI trong `fn` FAIL (permission denied). Mọi GHI audit (recordOperatorAction mỗi lần đọc) PHẢI đi
   * `withTenant(operator.companyId)` RIÊNG (audit_logs WITH CHECK keyed company_id ⇒ ghi ở home tenant của
   * operator), KHÔNG ghi trong ngữ cảnh này. Default-DENY ngoài helper: không SET ROLE ⇒ mediaos_app đọc
   * tenant-scoped như thường. Gọi CHỈ từ service ĐÃ qua PermissionGuard (read:db-all-tenant) + step-up +
   * break-glass all-tenant grant.
   */
  async withAllTenantReadContext<T>(fn: (tx: TenantTx) => Promise<T>): Promise<T> {
    if (!db) {
      throw new DatabaseNotConfiguredError();
    }
    return db.transaction(async (tx) => {
      // SET LOCAL ROLE: identifier cố định (KHÔNG nội suy giá trị client) → an toàn. LOCAL = tự reset.
      await tx.execute(sql`set local role mediaos_readonly`);
      // Bound đường đọc NẶNG NHẤT hệ (quét xuyên mọi tenant): statement_timeout LOCAL chặn slow-scan/DoS kể
      // cả khi caller đã hợp lệ (offset lớn / bảng to). LOCAL = tự reset khi commit (an toàn PgBouncer).
      await tx.execute(sql`set local statement_timeout = '30s'`);
      return fn(tx);
    });
  }
}
