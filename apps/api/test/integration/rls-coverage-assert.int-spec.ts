import { afterAll, describe, expect, it } from "vitest";
import { appPool, directPool, hasDb } from "../helpers/integration-db";

/**
 * GX-4 (g2rls) — CI ASSERT phủ RLS, ĐỘC LẬP với rls-registry.
 *
 * VÌ SAO không dùng RLS_TABLES: registry chỉ bắt được bảng CHƯA-đăng-ký (rls-guards.int-spec làm việc đó).
 * Nó KHÔNG bắt được bảng ĐÃ-đăng-ký nhưng quên FORCE, hoặc có policy thiếu vế ghi (WITH CHECK). Test này
 * truy THẲNG pg_class + pg_policies + information_schema để khẳng định BẤT BIẾN #1 (CLAUDE §2) ở tầng DB:
 *
 *   (a) MỌI bảng public có cột company_id ⇒ relrowsecurity=true VÀ relforcerowsecurity=true.
 *   (b) MỖI bảng đó có ÍT NHẤT 1 policy ép tenant cả ĐỌC và GHI theo current_setting('app.current_company_id'):
 *       - USING (qual) tham chiếu app.current_company_id, VÀ
 *       - WITH CHECK ép ghi cùng tenant. LƯU Ý Postgres: policy FOR ALL/UPDATE bỏ WITH CHECK ⇒ with_check
 *         hiển thị NULL trong pg_policies nhưng USING ĐƯỢC DÙNG LÀM check ngầm (verify thực nghiệm: cross-tenant
 *         INSERT bị chặn). Vì vậy "có vế ghi" = (with_check tham chiếu GUC) HOẶC (cmd ALL/UPDATE + qual tham chiếu GUC).
 *   (c) app role current_user = NOSUPERUSER + NOBYPASSRLS (guard chống false-green: superuser/bypass ⇒ RLS vô hiệu).
 *
 * Chạy trên Postgres thật (CI / mediaos_g2rls). Skip khi thiếu DB (không đỏ giả).
 */

const GUC = "app.current_company_id";

describe.skipIf(!hasDb)("GX-4 RLS coverage assert (registry-independent)", () => {
  const direct = directPool();
  const app = appPool(1);
  afterAll(async () => {
    await direct.end();
    await app.end();
  });

  async function companyIdTables(): Promise<string[]> {
    const { rows } = await direct.query<{ table_name: string }>(
      `SELECT c.relname AS table_name
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r'
         AND EXISTS (
           SELECT 1 FROM information_schema.columns col
           WHERE col.table_schema = 'public'
             AND col.table_name = c.relname
             AND col.column_name = 'company_id'
         )
       ORDER BY c.relname`,
    );
    return rows.map((r) => r.table_name);
  }

  it("(c) app-pool current_user = NOSUPERUSER + NOBYPASSRLS (RLS thật, không false-green)", async () => {
    const { rows } = await app.query(
      `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].rolsuper, "app role là SUPERUSER ⇒ RLS bị bỏ qua").toBe(false);
    expect(rows[0].rolbypassrls, "app role có BYPASSRLS ⇒ RLS bị bỏ qua").toBe(false);
  });

  it("(a) MỌI bảng company_id đều ENABLE + FORCE row level security", async () => {
    const tables = await companyIdTables();
    expect(tables.length).toBeGreaterThan(0); // sanity: schema đã migrate

    const { rows } = await direct.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname = ANY($1::text[])`,
      [tables],
    );
    const byName = new Map(rows.map((r) => [r.relname, r]));

    const notEnabled = tables.filter((t) => byName.get(t)?.relrowsecurity !== true);
    const notForced = tables.filter((t) => byName.get(t)?.relforcerowsecurity !== true);

    expect(notEnabled, `bảng company_id THIẾU ENABLE RLS: ${notEnabled.join(", ")}`).toEqual([]);
    expect(notForced, `bảng company_id THIẾU FORCE RLS: ${notForced.join(", ")}`).toEqual([]);
  });

  it("(b) MỖI bảng company_id có policy ép tenant cả USING (đọc) và WITH CHECK (ghi) theo GUC", async () => {
    const tables = await companyIdTables();

    // Lấy mọi policy của các bảng company_id 1 lần (tránh N query).
    const { rows: policies } = await direct.query<{
      tablename: string;
      cmd: string;
      qual: string | null;
      with_check: string | null;
    }>(
      `SELECT tablename, cmd, qual, with_check
       FROM pg_policies
       WHERE schemaname = 'public' AND tablename = ANY($1::text[])`,
      [tables],
    );

    // Bảng nào app role có thể GHI (INSERT/UPDATE)? Chỉ những bảng đó mới CẦN vế ghi (WITH CHECK) ép tenant.
    // Bảng SELECT-only (vd dead_letter_events — app chỉ đọc, worker mới ghi) KHÔNG cần app-write policy:
    // không có grant ghi ⇒ app không thể chèn/ghi hàng tenant khác dù policy không có WITH CHECK.
    const { rows: grantRows } = await direct.query<{ table_name: string }>(
      `SELECT DISTINCT table_name FROM information_schema.role_table_grants
       WHERE grantee = 'mediaos_app' AND table_schema = 'public'
         AND privilege_type IN ('INSERT', 'UPDATE') AND table_name = ANY($1::text[])`,
      [tables],
    );
    const appCanWrite = new Set(grantRows.map((r) => r.table_name));

    const refsGuc = (expr: string | null): boolean => !!expr && expr.includes(GUC);

    // "Đọc được ép tenant": tồn tại policy SELECT/ALL có USING tham chiếu GUC.
    const hasReadIsolation = (table: string): boolean =>
      policies.some(
        (p) =>
          p.tablename === table &&
          (p.cmd === "ALL" || p.cmd === "SELECT") &&
          refsGuc(p.qual),
      );

    // "Ghi được ép tenant": với INSERT, WITH CHECK phải tham chiếu GUC; với UPDATE/ALL, WITH CHECK
    // tường minh HOẶC USING (Postgres dùng USING làm check ngầm khi bỏ WITH CHECK). Coi là CÓ vế ghi nếu
    // tồn tại 1 policy cmd ∈ {ALL, INSERT, UPDATE} mà: with_check tham chiếu GUC, HOẶC (cmd ALL/UPDATE và qual tham chiếu GUC).
    const hasWriteIsolation = (table: string): boolean =>
      policies.some((p) => {
        if (p.tablename !== table) return false;
        if (refsGuc(p.with_check)) return true;
        return (p.cmd === "ALL" || p.cmd === "UPDATE") && refsGuc(p.qual);
      });

    const missingRead = tables.filter((t) => !hasReadIsolation(t));
    // Chỉ đòi vế ghi ở bảng app role THỰC SỰ ghi được — bảng SELECT-only đã an toàn bằng grant.
    const missingWrite = tables.filter((t) => appCanWrite.has(t) && !hasWriteIsolation(t));

    expect(
      missingRead,
      `bảng company_id THIẾU policy đọc (USING ${GUC}): ${missingRead.join(", ")}`,
    ).toEqual([]);
    expect(
      missingWrite,
      `bảng company_id (app ghi được) THIẾU policy ghi (WITH CHECK/USING ${GUC}): ${missingWrite.join(", ")}`,
    ).toEqual([]);
  });
});
