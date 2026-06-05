import { afterAll, describe, expect, it } from "vitest";
import { directPool, hasDb } from "../helpers/integration-db";

/**
 * G2-1 — kiểm chứng 3 DB role tách quyền (deny-path role/grant).
 * Chạy trên Postgres thật (CI). Điều kiện sống còn của tenant isolation: app role KHÔNG được
 * superuser/bypassrls/owner — nếu sai thì FORCE RLS vô hiệu (rủi ro "App role vô tình BYPASSRLS").
 */
describe.skipIf(!hasDb)("G2-1 DB roles", () => {
  const pool = directPool();
  afterAll(async () => {
    await pool.end();
  });

  it("mediaos_app KHÔNG superuser, KHÔNG bypassrls, KHÔNG createrole/createdb", async () => {
    const { rows } = await pool.query(
      `SELECT rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolcanlogin
       FROM pg_roles WHERE rolname = 'mediaos_app'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      rolsuper: false,
      rolbypassrls: false,
      rolcreaterole: false,
      rolcreatedb: false,
      rolcanlogin: true,
    });
  });

  it("mediaos_worker KHÔNG superuser, KHÔNG bypassrls", async () => {
    const { rows } = await pool.query(
      "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'mediaos_worker'",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ rolsuper: false, rolbypassrls: false });
  });

  it("mediaos_app KHÔNG là thành viên (kế thừa) của role superuser/bypassrls nào", async () => {
    // Kế thừa gián tiếp tới một role có quyền nguy hiểm cũng coi là rò.
    const { rows } = await pool.query(
      `WITH RECURSIVE memberships AS (
         SELECT roleid FROM pg_auth_members m
           JOIN pg_roles r ON r.oid = m.member WHERE r.rolname = 'mediaos_app'
         UNION
         SELECT m.roleid FROM pg_auth_members m JOIN memberships ms ON m.member = ms.roleid
       )
       SELECT r.rolname FROM memberships ms JOIN pg_roles r ON r.oid = ms.roleid
       WHERE r.rolsuper OR r.rolbypassrls`,
    );
    expect(rows).toHaveLength(0);
  });

  it("mediaos_app KHÔNG sở hữu bảng nào trong schema public", async () => {
    const { rows } = await pool.query(
      `SELECT c.relname FROM pg_class c
         JOIN pg_roles r ON r.oid = c.relowner
         JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE r.rolname = 'mediaos_app' AND n.nspname = 'public' AND c.relkind = 'r'`,
    );
    expect(rows).toHaveLength(0);
  });

  it("hàm pgbouncer.get_auth tồn tại (auth_query pass-through giữ user client tới Postgres)", async () => {
    const { rows } = await pool.query(
      `SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'pgbouncer' AND p.proname = 'get_auth'`,
    );
    expect(rows).toHaveLength(1);
  });
});
