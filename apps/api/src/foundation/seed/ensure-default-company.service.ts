import { Injectable, Logger } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { loadEnv } from "../../config/env.schema";

/** Kết quả tenant-ROOT mặc định sau khi ensure (id + trạng thái). */
export interface EnsuredCompany {
  id: string;
  status: string;
}

/**
 * EnsureDefaultCompanyService (S2-FND-SEED-3 / Lane B) — dựng-từ-trống tự động tenant-ROOT mặc định.
 *
 * Gọi hàm DB `ensure_default_company` (mig 0469 · SECURITY DEFINER · SET search_path=pg_catalog ·
 * REVOKE ALL FROM PUBLIC → GRANT EXECUTE mediaos_app) — LỖ THỦNG RLS CÓ KIỂM SOÁT, hợp lệ & HẸP cho việc
 * tạo tenant-ROOT khi CHƯA có tenant-context (mirror resolve_company_by_slug mig 0002, BẤT BIẾN #1). Toàn bộ
 * nghiệp vụ idempotent + N=1 guard nằm TRONG hàm SQL (một nguồn sự thật) — service này chỉ là caller MỎNG:
 *   • N=1 guard: đã có company active (chưa xoá mềm) → TRẢ về công ty đó, KHÔNG tạo tenant thứ 2 (owner-chốt #5).
 *   • Chưa có → INSERT ... ON CONFLICT (slug) DO NOTHING (idempotent chống race). Trả {id,status}.
 *
 * Đọc BOOTSTRAP_COMPANY_* từ env (đã validate ở env.schema — LANGUAGE ∈ {vi,en}, CURRENCY ∈ {VND,USD} khớp
 * companies CHECK). KHÔNG log secret (BẤT BIẾN #3 — chỉ log slug/id/status, không mật khẩu). Fail-safe: DB
 * chưa cấu hình → trả null (caller quyết định), KHÔNG ném.
 */
@Injectable()
export class EnsureDefaultCompanyService {
  private readonly logger = new Logger(EnsureDefaultCompanyService.name);

  /**
   * Đọc cấu hình từ env (loadEnv — validate BOOTSTRAP_COMPANY_* tại biên). Tách method để unit-test override seam.
   */
  protected loadConfig(): NodeJS.ProcessEnv {
    return loadEnv() as unknown as NodeJS.ProcessEnv;
  }

  /**
   * Ensure tenant-ROOT mặc định tồn tại. Trả {id,status} của company active (đã có qua N=1 guard hoặc vừa tạo);
   * null khi DB chưa cấu hình. KHÔNG ném lỗi CHECK vì env.schema đã ép language/currency hợp lệ TRƯỚC.
   */
  async ensureDefaultCompany(): Promise<EnsuredCompany | null> {
    if (!db) {
      this.logger.warn(
        "DATABASE_URL chưa cấu hình — bỏ qua ensure default company (đặt BOOTSTRAP_COMPANY_* + DB rồi khởi động lại).",
      );
      return null;
    }
    const env = this.loadConfig();
    const slug = env.BOOTSTRAP_COMPANY_SLUG ?? "demo";
    const name = env.BOOTSTRAP_COMPANY_NAME ?? "Demo Company";
    const timezone = env.BOOTSTRAP_COMPANY_TIMEZONE ?? "Asia/Ho_Chi_Minh";
    const language = env.BOOTSTRAP_COMPANY_LANGUAGE ?? "vi";
    const currency = env.BOOTSTRAP_COMPANY_CURRENCY ?? "VND";

    // ensure_default_company(p_slug citext, p_name text, p_timezone text, p_language text, p_currency text).
    // Param string → citext resolve như resolve_company_by_slug (mig 0002) — KHÔNG cast tay.
    const res = await db.execute(
      sql`SELECT id, status FROM ensure_default_company(${slug}, ${name}, ${timezone}, ${language}, ${currency})`,
    );
    const row = res.rows[0] as unknown as EnsuredCompany | undefined;
    return row ?? null;
  }
}
