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

  async withPlatformContext<T>(fn: (tx: TenantTx) => Promise<T>): Promise<T> {
    if (!db) {
      throw new DatabaseNotConfiguredError();
    }
    return db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.platform_admin', 'on', true)`);
      return fn(tx);
    });
  }
}
