import { Injectable } from "@nestjs/common";
import { and, eq, isNull, sql } from "drizzle-orm";
import { dashboardWidgetConfigs, dashboardWidgets } from "../db/schema/dashboard";
import type {
  MasterDataSeedContext,
  ModuleMasterDataSeeder,
} from "../foundation/seed/master-data-seeder.types";
import { DASH_DEFAULT_CONFIG } from "./dashboard-widget-catalog.const";

/**
 * S4-DASH-SEED-1 — RUNTIME per-company seeder cho default dashboard_widget_configs.
 *
 * VÌ SAO RUNTIME (không migration): `dashboard_widget_configs.company_id` NOT NULL, mà company mặc định chỉ
 * tồn tại SAU BOOT (`ensure_default_company`, mig 0469) — tức SAU migrate. Seed trong migration sẽ resolve 0
 * company. Module DASH đăng ký seeder này vào MasterDataSeederRegistry (qua DashSeedRegistrar) →
 * MasterDataSeedRunner chạy cho MỖI company trong tenant tx (RLS + FORCE ép company_id, BẤT BIẾN #1).
 *
 * IDEMPOTENT KHÔNG DÙNG ON CONFLICT: `dashboard_widget_configs` KHÔNG có unique index nào (mig 0482 chỉ tạo
 * index non-unique) ⇒ `ON CONFLICT (...)` sẽ ném "no unique or exclusion constraint matching". Dùng
 * `INSERT ... SELECT ... WHERE NOT EXISTS`, khoá trên KHOÁ NGHIỆP VỤ đầy đủ:
 *     (company_id, widget_id, dashboard_type, config_scope, role_id IS NULL, user_id IS NULL)
 * Chỉ so (company_id, widget_id) sẽ chặn nhầm, vì TASK_ALERTS và NOTIFICATIONS xuất hiện ở NHIỀU
 * dashboard_type.
 *
 * GRANT: mig 0484 cấp `INSERT` (và chỉ INSERT) trên bảng này cho mediaos_app — seeder chỉ INSERT
 * (master-data-seeder.types.ts:15 "Seeder CHỈ làm INSERT"). Không DELETE, không UPDATE (BẤT BIẾN #2).
 */
@Injectable()
export class DashboardConfigSeeder implements ModuleMasterDataSeeder {
  readonly seedKey = "dash.default-configs";
  readonly seedVersion = "v1";

  async seed(ctx: MasterDataSeedContext): Promise<void> {
    for (const entry of DASH_DEFAULT_CONFIG) {
      await this.seedOne(ctx, entry.dashboardType, entry.widgetCode, entry.sortOrder);
    }
  }

  private async seedOne(
    ctx: MasterDataSeedContext,
    dashboardType: string,
    widgetCode: string,
    sortOrder: number,
  ): Promise<void> {
    const { companyId, tx, track } = ctx;

    // Widget catalog là GLOBAL (company_id NULL) — seed bởi mig 0484. Thiếu ⇒ migration chưa chạy: fail LOUD
    // thay vì âm thầm bỏ qua (runner sẽ mark batch Failed).
    const [widget] = await tx
      .select({ id: dashboardWidgets.id })
      .from(dashboardWidgets)
      .where(
        and(
          isNull(dashboardWidgets.companyId),
          eq(dashboardWidgets.widgetCode, widgetCode),
          isNull(dashboardWidgets.deletedAt),
        ),
      )
      .limit(1);

    if (!widget) {
      throw new Error(
        `[dash.default-configs] widget GLOBAL '${widgetCode}' không tồn tại — migration 0484 phải chạy trước`,
      );
    }

    // INSERT ... SELECT ... WHERE NOT EXISTS trên khoá nghiệp vụ đầy đủ (xem doc-block).
    await tx.execute(sql`
      INSERT INTO dashboard_widget_configs
        (company_id, widget_id, dashboard_type, config_scope, role_id, user_id, is_enabled, sort_order)
      SELECT ${companyId}::uuid, ${widget.id}::uuid, ${dashboardType}, 'Company', NULL, NULL, true, ${sortOrder}
      WHERE NOT EXISTS (
        SELECT 1 FROM dashboard_widget_configs c
         WHERE c.company_id = ${companyId}::uuid
           AND c.widget_id = ${widget.id}::uuid
           AND c.dashboard_type = ${dashboardType}
           AND c.config_scope = 'Company'
           AND c.role_id IS NULL
           AND c.user_id IS NULL
           AND c.deleted_at IS NULL
      )
    `);

    await track({
      targetTable: "dashboard_widget_configs",
      targetKey: `${dashboardType}:${widgetCode}`,
      payload: { dashboardType, widgetCode, sortOrder, configScope: "Company" },
      targetId: widget.id,
    });
  }
}
