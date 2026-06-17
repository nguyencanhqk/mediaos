/**
 * AC-4 menu động — ui_navigation effective gate theo module-state (FeatureFlagService).
 * RED-first: UiConfigService.getEffectiveNavigation + 3 bảng chưa tồn tại tới khi AC-4 GREEN.
 *
 * BẤT BIẾN menu-gate: item có module_key trỏ feature TẮT bị ẩn khỏi effective menu; item module_key=null
 * hoặc module BẬT thì hiện; is_visible=false luôn ẩn. Module-state đọc DUY NHẤT từ FeatureFlagService
 * (company_feature_flags override — KHÔNG bảng on/off song song).
 */

import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import { UiConfigService } from "../../src/settings/ui-config.service";
import { directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";

const ENABLED_FEATURE = "ac4_feat_on";
const DISABLED_FEATURE = "ac4_feat_off";

describe.skipIf(!hasDb)("AC-4 ui-navigation module-gate (effective menu)", () => {
  let direct: Pool;
  let service: UiConfigService;
  let A: SeededTenant;
  let actorId: string;
  const companyIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    await moduleRef.init();
    service = moduleRef.get(UiConfigService);
    direct = directPool();

    A = await seedCompany(direct, "uicfgGate");
    companyIds.push(A.companyId);
    actorId = await seedUser(direct, A.companyId, `gate-${randomUUID().slice(0, 8)}@a.test`);

    // Override per-company THẮNG ở FeatureFlagService: bật ENABLED_FEATURE, tắt DISABLED_FEATURE tường minh.
    await direct.query(
      `INSERT INTO company_feature_flags (company_id, feature_key, enabled) VALUES ($1, $2, true)`,
      [A.companyId, ENABLED_FEATURE],
    );
    await direct.query(
      `INSERT INTO company_feature_flags (company_id, feature_key, enabled) VALUES ($1, $2, false)`,
      [A.companyId, DISABLED_FEATURE],
    );

    // 4 item: null-module (hiện), module-ON (hiện), module-OFF (ẩn), invisible (ẩn dù module null).
    const items: Array<[string, string | null, boolean]> = [
      ["nav-null", null, true],
      ["nav-on", ENABLED_FEATURE, true],
      ["nav-off", DISABLED_FEATURE, true],
      ["nav-hidden", null, false],
    ];
    let order = 0;
    for (const [key, moduleKey, isVisible] of items) {
      await direct.query(
        `INSERT INTO ui_navigation_config
           (company_id, key, label, route, display_order, module_key, is_visible)
         VALUES ($1, $2, $2, '/r', $3, $4, $5)`,
        [A.companyId, key, order++, moduleKey, isVisible],
      );
    }
  });

  afterAll(async () => {
    if (companyIds.length) await cleanupTenants(direct, companyIds);
    await direct.end();
  });

  it("effective menu: hiện item null-module + module BẬT; ẩn item module TẮT; ẩn item is_visible=false", async () => {
    const effective = await service.getEffectiveNavigation({ id: actorId, companyId: A.companyId });
    const keys = effective.map((i) => i.key).sort();
    expect(keys).toEqual(["nav-null", "nav-on"]);
    // nav-off (module tắt) + nav-hidden (is_visible=false) bị ẩn.
    expect(keys).not.toContain("nav-off");
    expect(keys).not.toContain("nav-hidden");
  });

  it("config raw (KHÔNG gate): trả mọi item đang sống kể cả module tắt (admin sửa)", async () => {
    const raw = await service.getNavigationConfig({ id: actorId, companyId: A.companyId });
    const keys = raw.map((i) => i.key).sort();
    expect(keys).toEqual(["nav-hidden", "nav-null", "nav-off", "nav-on"]);
  });
});
