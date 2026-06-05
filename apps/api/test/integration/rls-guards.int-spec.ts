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

  it("KHÔNG bảng nào có cột company_id mà thiếu case trong registry (lưới không thủng im lặng)", async () => {
    const { rows } = await direct.query(
      `SELECT table_name FROM information_schema.columns
       WHERE table_schema = 'public' AND column_name = 'company_id'`,
    );
    const tablesWithCompanyId = rows.map((r) => r.table_name as string);
    const registered = new Set(RLS_TABLES.map((t) => t.table));
    const missing = tablesWithCompanyId.filter((t) => !registered.has(t));
    expect(missing, `bảng có company_id chưa đăng ký harness: ${missing.join(", ")}`).toEqual([]);
  });
});
