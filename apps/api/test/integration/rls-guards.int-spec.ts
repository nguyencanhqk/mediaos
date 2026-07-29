import { afterAll, describe, expect, it } from "vitest";
import { appPool, directPool, hasDb } from "../helpers/integration-db";
import { RLS_TABLES } from "./rls-registry";

/**
 * G2 — GUARD CHỐNG "XANH GIẢ" (review G2: nếu CI cấu hình sai, mọi test isolation vẫn xanh trong khi
 * RLS bị bypass). Ba chốt: (1) app-pool đúng là role NOSUPERUSER+NOBYPASSRLS; (2) mọi bảng registry
 * có RLS+FORCE thật; (3) không bảng nào có company_id mà thiếu case trong registry. Postgres thật (CI).
 */
describe.skipIf(!hasDb)("G2 RLS guards (chống false-green)", () => {
  const app = appPool(1);
  const direct = directPool();
  afterAll(async () => {
    await app.end();
    await direct.end();
  });

  it("app-pool kết nối bằng role NOSUPERUSER + NOBYPASSRLS (không phải superuser ⇒ RLS được ép thật)", async () => {
    const { rows } = await app.query(
      `SELECT current_user AS role, rolsuper, rolbypassrls
       FROM pg_roles WHERE rolname = current_user`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].rolsuper).toBe(false);
    expect(rows[0].rolbypassrls).toBe(false);
  });

  it("mọi bảng trong registry đều ENABLE + FORCE row level security", async () => {
    const names = RLS_TABLES.map((t) => t.table);
    const { rows } = await direct.query(
      `SELECT relname, relrowsecurity, relforcerowsecurity
       FROM pg_class WHERE relname = ANY($1::text[]) AND relkind = 'r'`,
      [names],
    );
    expect(rows.length).toBe(names.length);
    for (const r of rows) {
      expect(r.relrowsecurity, `${r.relname} thiếu ENABLE RLS`).toBe(true);
      expect(r.relforcerowsecurity, `${r.relname} thiếu FORCE RLS`).toBe(true);
    }
  });

  /**
   * Mọi object mang `company_id` phải có MỘT cơ chế cô lập, và ca này liệt kê theo `pg_class` chứ
   * không theo `information_schema.columns`.
   *
   * ⚠️ VÌ SAO ĐỔI NGUỒN LIỆT KÊ (S6-SEC-MV-1, 2026-07-29 — đây chính là gốc của KI-041):
   * `information_schema.columns` **KHÔNG liệt kê materialized view** (Postgres bỏ chúng ra khỏi
   * information_schema). Vì vậy `mv_dashboard_output` + `mv_dashboard_task_status` — hai object MANG
   * `company_id` và KHÔNG thể có RLS — **chưa bao giờ lọt vào lưới này**. Chốt "không thủng im lặng"
   * đã thủng đúng ở chỗ nó hứa canh. `pg_class` thấy cả ba loại (`r` bảng · `m` matview · `v` view).
   */
  it("KHÔNG object nào có company_id mà nằm ngoài lưới (bảng · matview · view)", async () => {
    const { rows } = await direct.query(
      `SELECT c.relkind::text AS kind, c.relname AS name,
              has_table_privilege('mediaos_app', c.oid, 'SELECT') AS app_select,
              coalesce(array_to_string(c.reloptions, ','), '') AS opts
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_attribute a ON a.attrelid = c.oid
                            AND a.attname = 'company_id'
                            AND a.attnum > 0 AND NOT a.attisdropped
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'm', 'v')
        GROUP BY c.relkind, c.relname, c.oid, c.reloptions`,
    );
    const of = (k: string) => rows.filter((r) => r.kind === k);

    // (a) BẢNG — cơ chế cô lập là RLS ⇒ phải có case trong registry.
    const registered = new Set(RLS_TABLES.map((t) => t.table));
    const missing = of("r")
      .map((r) => r.name as string)
      .filter((t) => !registered.has(t));
    expect(missing, `bảng có company_id chưa đăng ký harness: ${missing.join(", ")}`).toEqual([]);

    // (b) MATVIEW — Postgres KHÔNG hỗ trợ RLS trên matview, nên cơ chế cô lập DUY NHẤT chấp nhận
    // được là app role KHÔNG có cửa đọc thẳng (mig 0534: REVOKE + đọc qua view chắn).
    const leakyMv = of("m")
      .filter((r) => r.app_select === true)
      .map((r) => r.name as string);
    expect(
      leakyMv,
      `matview mang company_id mà app role VẪN đọc thẳng được: ${leakyMv.join(", ")}. ` +
        `Matview không có RLS ⇒ ranh giới phải là REVOKE SELECT + view security_barrier (xem KI-041 / mig 0534).`,
    ).toEqual([]);

    // (c) VIEW phơi company_id — phải là `security_barrier`, nếu không planner được đẩy hàm do người
    // dùng cung cấp xuống DƯỚI vế lọc tenant (leaky view) và quan sát được hàng của tenant khác.
    const leakyView = of("v")
      .filter((r) => !String(r.opts).includes("security_barrier=true"))
      .map((r) => r.name as string);
    expect(
      leakyView,
      `view mang company_id mà thiếu security_barrier: ${leakyView.join(", ")}`,
    ).toEqual([]);
  });
});
