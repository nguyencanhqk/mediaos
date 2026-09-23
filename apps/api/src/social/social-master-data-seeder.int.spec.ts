/**
 * S16-SOCIAL-BE-2A (Bước 0.2 — nợ (a) của DB-2) — `SocialMasterDataSeeder` qua ĐƯỜNG THẬT
 * (`MasterDataSeedRunner.reconcileCompany`), khuôn `att-master-data-seeder.int.spec.ts`.
 *
 * VÌ SAO WO NÀY CÓ TEST NÀY: migration `0582` chỉ seed catalog huy hiệu cho công ty ĐANG TỒN TẠI lúc
 * migrate. Một cài đặt PROD mới chạy migrate TRƯỚC khi boot app ⇒ lúc `0582` chạy, `companies` rỗng,
 * file là no-op có bảo đảm; công ty sinh sau đó (`ensure-default-company.service.ts`) sẽ có catalog
 * huy hiệu **RỖNG** và không đường nào vá — đúng hình dạng `empty-success-is-the-fail-open-shape`.
 *
 * Gate cứng `hasDb && LANE_DB` (memory `integration-test-lane-db-gate`). Chạy bằng app role
 * (`mediaos_app`, RLS+FORCE) — KHÔNG owner. KHÔNG gọi `seed()` trực tiếp: đăng ký seeder vào registry
 * rồi gọi `runner.reconcileCompany(companyId)` (đường mà boot thật đi qua).
 *
 * Phủ:
 *   G1 — công ty MỚI (sinh sau khi `0582` đã chạy) ⇒ sau reconcile có ĐÚNG 5 huy hiệu hệ thống, đúng
 *        `code`/`position`/`is_active`; batch `social.master-data` = Success.
 *   G2 — neo chống-DRIFT với `0582`: tập mã của seeder BẰNG ĐÚNG tập mã migration đã seed (không
 *        thừa, không thiếu) ⇒ công ty cũ và công ty mới thấy CÙNG một catalog.
 *   I2 — chạy lần 2 idempotent: không nhân bản hàng, batch không Failed.
 */

import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseService } from "../db/db.service";
import { directPool, hasDb } from "../../test/helpers/integration-db";
import { cleanupTenants, seedCompany, type SeededTenant } from "../../test/helpers/seed";
import { MasterDataSeedRunner } from "../foundation/seed/master-data-seed-runner.service";
import { MasterDataSeederRegistry } from "../foundation/seed/master-data-seeder.registry";
import { SeedTrackingService } from "../foundation/seed/seed-tracking.service";
import { SOCIAL_SYSTEM_BADGES, SocialMasterDataSeeder } from "./social-master-data.seeder";

const runDb = hasDb && Boolean(process.env.LANE_DB);
const SEED_KEY = "social.master-data";

/** Nguồn sự thật ĐỘC LẬP của test — chép tay từ `0582`, KHÔNG import từ seeder (nếu không thì G2 tự chứng minh chính nó). */
const EXPECTED_CODES = ["teamwork", "innovation", "customer-first", "mentor", "above-beyond"];

async function badgesOf(
  direct: Pool,
  companyId: string,
): Promise<{ code: string; position: number; is_active: boolean; name: string }[]> {
  const r = await direct.query(
    "SELECT code, position::int AS position, is_active, name FROM feed_kudos_badges WHERE company_id=$1 ORDER BY position",
    [companyId],
  );
  return r.rows;
}

describe.skipIf(!runDb)("S16-SOCIAL-BE-2A SocialMasterDataSeeder (DB cô lập, app role)", () => {
  let direct: Pool;
  let A: SeededTenant;
  let runner: MasterDataSeedRunner;

  beforeAll(async () => {
    direct = directPool();
    A = await seedCompany(direct, "socseed");

    const dbsvc = new DatabaseService();
    const tracking = new SeedTrackingService(dbsvc);
    const registry = new MasterDataSeederRegistry();
    registry.register(new SocialMasterDataSeeder());
    runner = new MasterDataSeedRunner(dbsvc, tracking, registry);
  });

  afterAll(async () => {
    if (direct) {
      await cleanupTenants(direct, [A.companyId]);
      await direct.end();
    }
  });

  it("G1 — công ty mới: TRƯỚC reconcile catalog RỖNG, SAU reconcile có đủ 5 huy hiệu (Success)", async () => {
    // Neo dương: chứng minh công ty fixture thật sự chưa có huy hiệu nào (nếu không, mọi assert dưới
    // đây có thể xanh nhờ `0582` chứ không nhờ seeder — ca test sẽ vô nghĩa).
    expect(await badgesOf(direct, A.companyId)).toHaveLength(0);

    const outcomes = await runner.reconcileCompany(A.companyId);
    const social = outcomes.find((o) => o.seedKey === SEED_KEY);
    expect(social?.ok, "batch social.master-data phải ok").toBe(true);
    expect(social?.status).toBe("Success");

    const rows = await badgesOf(direct, A.companyId);
    expect(rows.map((r) => r.code)).toEqual(EXPECTED_CODES);
    expect(rows.map((r) => r.position)).toEqual([1, 2, 3, 4, 5]);
    expect(rows.every((r) => r.is_active)).toBe(true);
    expect(rows.every((r) => r.name.trim().length > 0)).toBe(true);
  });

  it("G2 — tập mã của seeder KHỚP ĐÚNG tập mã migration 0582 (chống drift catalog)", () => {
    expect([...SOCIAL_SYSTEM_BADGES].map((b) => b.code)).toEqual(EXPECTED_CODES);
    expect([...SOCIAL_SYSTEM_BADGES].map((b) => b.position)).toEqual([1, 2, 3, 4, 5]);
  });

  it("I2 — reconcile lần 2 idempotent: vẫn ĐÚNG 5 hàng, batch không Failed", async () => {
    const outcomes = await runner.reconcileCompany(A.companyId);
    const social = outcomes.find((o) => o.seedKey === SEED_KEY);
    expect(social?.status).not.toBe("Failed");

    const rows = await badgesOf(direct, A.companyId);
    expect(rows).toHaveLength(5);
    expect(rows.map((r) => r.code)).toEqual(EXPECTED_CODES);
  });
});
