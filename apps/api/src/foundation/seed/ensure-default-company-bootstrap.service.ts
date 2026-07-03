import { Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { loadEnv } from "../../config/env.schema";
import { EnsureDefaultCompanyService } from "./ensure-default-company.service";

/**
 * EnsureDefaultCompanyBootstrapService (S2-FND-SEED-3 / Lane B) — trigger dựng tenant-ROOT mặc định LÚC
 * KHỞI ĐỘNG (runtime, KHÔNG migration; migration KHÔNG seed company-scoped — convention 0445/0008).
 *
 * Là "chủ sở hữu" chính thức của bước ensure-default-company: chạy OnApplicationBootstrap để company mặc định
 * luôn tồn tại kể cả khi KHÔNG bật super-admin (PLATFORM_SUPERADMIN_EMAIL vắng). Chuỗi single-boot (company +
 * admin) được BẢO ĐẢM THỨ TỰ bởi SuperAdminBootstrapService TỰ gọi ensureDefaultCompany() TRƯỚC khi seed admin
 * — vì hook OnApplicationBootstrap giữa các module KHÔNG có thứ tự đảm bảo (PermissionModule là dependency sâu
 * hơn SeedModule ⇒ hook của nó chạy TRƯỚC). Cả hai lối gọi đều idempotent + N=1 guard trong hàm SQL nên gọi
 * 2 lần là vô hại.
 *
 * Fail-safe (mẫu MasterDataSeedBootstrapService): lỗi ensure KHÔNG BAO GIỜ sập boot — chỉ log. Env thiếu →
 * BOOTSTRAP_COMPANY_* có default (zero-config) nên vẫn dựng được; nếu DB chưa cấu hình → log hướng dẫn, bỏ qua.
 * NODE_ENV='test' → no-op (int-spec gọi EnsureDefaultCompanyService trực tiếp; tránh đua/nhiễu test).
 *
 * KHÔNG audit riêng cho company auto-create (owner-chốt #7) — audit auth.super_admin_bootstrapped GIỮ NGUYÊN.
 */
@Injectable()
export class EnsureDefaultCompanyBootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(EnsureDefaultCompanyBootstrapService.name);

  constructor(private readonly ensureDefaultCompany: EnsureDefaultCompanyService) {}

  async onApplicationBootstrap(): Promise<void> {
    if (loadEnv().NODE_ENV === "test") {
      this.logger.debug(
        "NODE_ENV=test — KHÔNG auto-ensure default company (spec gọi service trực tiếp).",
      );
      return;
    }
    try {
      const company = await this.ensureDefaultCompany.ensureDefaultCompany();
      if (!company) {
        this.logger.warn(
          "default company chưa dựng được (DB chưa cấu hình?) — kiểm tra DATABASE_URL + BOOTSTRAP_COMPANY_*.",
        );
        return;
      }
      // Log AN TOÀN: chỉ id/status (KHÔNG secret — BẤT BIẾN #3).
      this.logger.log(
        `default company sẵn sàng (id=${company.id}, status=${company.status}) — bootstrap idempotent.`,
      );
    } catch (err) {
      // Fail-safe: KHÔNG sập boot vì ensure company lỗi (mẫu MasterDataSeedBootstrapService).
      this.logger.error(
        `ensure default company lỗi — bỏ qua, KHÔNG sập boot (${err instanceof Error ? err.message : String(err)}).`,
      );
    }
  }
}
